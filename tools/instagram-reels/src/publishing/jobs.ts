import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { loadAutomationConfig, runtimeEnvironmentValue } from "../config/automation.js";
import { loadConfig, type MediaConfig } from "../config/index.js";
import { derivedReelById, latestEditorialPackage, openDatabase, publicationJobById, publicationJobByKey, createPublicationJob, setPublicationStatus, updatePublicationJob, successfulPublicationExists } from "../database/db.js";
import type { EligibilityResult, PublicationJob, PublicationMode, PublicationPayload, PublicationStatus } from "../shared/types.js";
import { audit } from "./audit.js";
import { evaluateEligibility } from "./eligibility.js";
import { DryRunInstagramPublisher, MetaInstagramPublisher, type PublisherResult, type SocialPublisher } from "./publishers.js";
import { DryRunPublicationMediaProvider } from "./media-provider.js";

function iso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_SCHEDULED_AT");
  return date.toISOString();
}

export function publicationKey(reelId: string, editorialVersion: number, targetAccount: string, plannedIdentity = "default"): string {
  const input = `${reelId}\n${editorialVersion}\n${targetAccount}\n${plannedIdentity}`;
  return `publication-${crypto.createHash("sha256").update(input).digest("hex").slice(0, 32)}`;
}

function targetAccount(): string {
  return runtimeEnvironmentValue("INSTAGRAM_ACCOUNT_ID") || "dry-run-account";
}

function safePayload(payload: PublicationPayload): string {
  return JSON.stringify({
    publication_key: payload.publication_key,
    reel_id: payload.reel_id,
    editorial_version: payload.editorial_version,
    caption: payload.caption,
    video_url: payload.video_url,
    cover_path: payload.cover_path,
    target_account: payload.target_account,
  });
}

function publisherFor(mode: PublicationMode): SocialPublisher {
  return mode === "dry-run" ? new DryRunInstagramPublisher() : new MetaInstagramPublisher();
}

function jobView(row: Record<string, unknown>): PublicationJob {
  return {
    publication_job_id: String(row.publication_job_id),
    publication_key: String(row.publication_key),
    reel_id: String(row.reel_id),
    editorial_version: Number(row.editorial_version),
    publisher: String(row.publisher),
    mode: String(row.mode) as PublicationMode,
    scheduled_at: String(row.scheduled_at),
    timezone: String(row.timezone),
    status: String(row.status) as PublicationStatus,
    attempt_count: Number(row.attempt_count ?? 0),
    max_attempts: Number(row.max_attempts ?? 3),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    last_attempt_at: row.last_attempt_at ? String(row.last_attempt_at) : null,
    published_at: row.published_at ? String(row.published_at) : null,
    remote_container_id: row.remote_container_id ? String(row.remote_container_id) : null,
    remote_media_id: row.remote_media_id ? String(row.remote_media_id) : null,
    error_code: row.error_code ? String(row.error_code) : null,
    error_message_safe: row.error_message_safe ? String(row.error_message_safe) : null,
    failure_class: row.failure_class ? String(row.failure_class) as PublicationJob["failure_class"] : null,
  };
}

async function payloadFor(reelId: string, version: number, key: string, mode: PublicationMode, config: MediaConfig): Promise<PublicationPayload> {
  const db = openDatabase(config);
  try {
    const reel = derivedReelById(db, reelId);
    const editorial = latestEditorialPackage(db, reelId);
    if (!reel || !editorial) throw new Error("EDITORIAL_PACKAGE_NOT_FOUND");
    if (Number(editorial.editorial_version) !== version) throw new Error("EDITORIAL_VERSION_NOT_LATEST");
    const publisher = publisherFor(mode);
    const payload = await publisher.preparePublication({
      reelId,
      editorialVersion: version,
      caption: editorial.caption,
      coverPath: editorial.cover_path,
      targetAccount: targetAccount(),
    });
    return { ...payload, publication_key: key, reel_id: reelId, editorial_version: version, caption: editorial.caption, cover_path: editorial.cover_path };
  } finally { db.close(); }
}

export async function runDryRun(reelId: string, config: MediaConfig = loadConfig()): Promise<{ eligibility: EligibilityResult; job: PublicationJob; payload: PublicationPayload }> {
  const account = targetAccount();
  const eligibility = await evaluateEligibility(reelId, { targetAccount: account }, config);
  const db = openDatabase(config);
  try {
    const editorial = latestEditorialPackage(db, reelId);
    if (!editorial) throw new Error("EDITORIAL_PACKAGE_NOT_FOUND");
    const key = publicationKey(reelId, Number(editorial.editorial_version), account, "dry-run");
    const existing = publicationJobByKey(db, key);
    if (existing) return { eligibility, job: jobView(existing), payload: JSON.parse(String(existing.payload_json_safe)) as PublicationPayload };
    const payload = await payloadFor(reelId, Number(editorial.editorial_version), key, "dry-run", config);
    const dryRunResult = await new DryRunInstagramPublisher().publish({ jobId: key, payload, mode: "dry-run" });
    const simulatedStatus: PublicationStatus = eligibility.status === "READY_FOR_PUBLISHING" && dryRunResult.status === "DRY_RUN_VALIDATED" ? "DRY_RUN_VALIDATED" : "DRY_RUN_BLOCKED";
    createPublicationJob(db, {
      jobId: randomUUID(), publicationKey: key, reelId, editorialVersion: Number(editorial.editorial_version),
      publisher: "dry-run", mode: "dry-run", scheduledAt: new Date().toISOString(), timezone: loadAutomationConfig().timezone,
      status: simulatedStatus, maxAttempts: 1,
      payloadJsonSafe: safePayload(payload),
    });
    const job = publicationJobByKey(db, key);
    if (!job) throw new Error("PUBLICATION_JOB_CREATE_FAILED");
    audit(db, { entityType: "publication_job", entityId: String(job.publication_job_id), eventType: "DRY_RUN_EXECUTED", actor: "operator", metadata: { eligibility: eligibility.status, reasons: eligibility.reasons } });
    return { eligibility, job: jobView(job), payload };
  } finally { db.close(); }
}

export async function schedulePublication(reelId: string, scheduledAt: string, actor: string, config: MediaConfig = loadConfig()): Promise<{ eligibility: EligibilityResult; job: PublicationJob }> {
  if (!actor.trim()) throw new Error("ACTOR_REQUIRED");
  const at = iso(scheduledAt);
  const automation = loadAutomationConfig();
  const account = targetAccount();
  const eligibility = await evaluateEligibility(reelId, { at, targetAccount: account }, config);
  const db = openDatabase(config);
  try {
    const editorial = latestEditorialPackage(db, reelId);
    if (!editorial) throw new Error("EDITORIAL_PACKAGE_NOT_FOUND");
    const version = Number(editorial.editorial_version);
    const key = publicationKey(reelId, version, account, `scheduled:${at}`);
    const existing = publicationJobByKey(db, key);
    if (existing) return { eligibility, job: jobView(existing) };
    const mode = automation.publishMode;
    const payload = await payloadFor(reelId, version, key, mode, config);
    const status: PublicationStatus = mode === "dry-run" ? "SCHEDULED" : eligibility.status === "READY_FOR_PUBLISHING" ? "SCHEDULED" : "NOT_ELIGIBLE";
    createPublicationJob(db, {
      jobId: randomUUID(), publicationKey: key, reelId, editorialVersion: version,
      publisher: mode === "dry-run" ? "dry-run" : "meta", mode, scheduledAt: at, timezone: automation.timezone,
      status, maxAttempts: mode === "dry-run" ? 1 : 3, payloadJsonSafe: safePayload(payload),
    });
    const job = publicationJobByKey(db, key);
    if (!job) throw new Error("PUBLICATION_JOB_CREATE_FAILED");
    audit(db, { entityType: "publication_job", entityId: String(job.publication_job_id), eventType: "SCHEDULE_CREATED", actor, metadata: { scheduled_at: at, mode, eligibility: eligibility.status, reasons: eligibility.reasons } });
    return { eligibility, job: jobView(job) };
  } finally { db.close(); }
}

export function cancelPublication(jobId: string, actor: string, config: MediaConfig = loadConfig()): PublicationJob {
  if (!actor.trim()) throw new Error("ACTOR_REQUIRED");
  const db = openDatabase(config);
  try {
    const row = publicationJobById(db, jobId);
    if (!row) throw new Error("PUBLICATION_JOB_NOT_FOUND");
    updatePublicationJob(db, jobId, { status: "CANCELLED", errorCode: null, errorMessageSafe: null, failureClass: null, nextAttemptAt: null });
    audit(db, { entityType: "publication_job", entityId: jobId, eventType: "SCHEDULE_CANCELLED", actor, metadata: {} });
    const updated = publicationJobById(db, jobId);
    if (!updated) throw new Error("PUBLICATION_JOB_NOT_FOUND");
    return jobView(updated);
  } finally { db.close(); }
}

export function publicationStatus(jobId: string, config: MediaConfig = loadConfig()): PublicationJob {
  const db = openDatabase(config);
  try {
    const row = publicationJobById(db, jobId);
    if (!row) throw new Error("PUBLICATION_JOB_NOT_FOUND");
    return jobView(row);
  } finally { db.close(); }
}

export async function processLockedPublicationJob(jobId: string, workerId: string, config: MediaConfig = loadConfig(), publisherOverride?: SocialPublisher): Promise<PublicationJob> {
  const db = openDatabase(config);
  try {
    const row = publicationJobById(db, jobId);
    if (!row || String(row.status) !== "PUBLISHING") throw new Error("PUBLICATION_JOB_NOT_LOCKED");
    const job = jobView(row);
    const payload = JSON.parse(String(row.payload_json_safe ?? "{}")) as PublicationPayload;
    const eligibility = await evaluateEligibility(job.reel_id, { targetAccount: payload.target_account }, config);
    if (eligibility.status !== "READY_FOR_PUBLISHING") {
      const external = eligibility.reasons.some((reason) => reason.startsWith("META_"));
      const blockedStatus: PublicationStatus = job.mode === "dry-run" ? "DRY_RUN_BLOCKED" : external ? "BLOCKED_EXTERNAL" : "NOT_ELIGIBLE";
      updatePublicationJob(db, jobId, { status: blockedStatus, errorCode: eligibility.reasons[0] ?? "NOT_ELIGIBLE", errorMessageSafe: "Publication eligibility gates did not pass.", failureClass: external ? "EXTERNAL_BLOCKER" : "VALIDATION", nextAttemptAt: null });
      audit(db, { entityType: "publication_job", entityId: jobId, eventType: "PUBLICATION_BLOCKED", actor: workerId, metadata: { reasons: eligibility.reasons } });
      const updated = publicationJobById(db, jobId);
      if (!updated) throw new Error("PUBLICATION_JOB_NOT_FOUND");
      return jobView(updated);
    }
    const publisher = publisherOverride ?? publisherFor(job.mode);
    const result: PublisherResult = await publisher.publish({ jobId, payload, mode: job.mode });
    if (result.status === "PUBLISHED") {
      updatePublicationJob(db, jobId, { status: "PUBLISHED", errorCode: null, errorMessageSafe: null, failureClass: null, nextAttemptAt: null, remoteContainerId: result.remoteContainerId, remoteMediaId: result.remoteMediaId, publishedAt: new Date().toISOString() });
      setPublicationStatus(db, job.reel_id, "PUBLISHED");
      audit(db, { entityType: "publication_job", entityId: jobId, eventType: "PUBLICATION_SUCCEEDED", actor: workerId, metadata: { remote_media_id: result.remoteMediaId ?? null } });
    } else if (result.status === "DRY_RUN_VALIDATED") {
      updatePublicationJob(db, jobId, { status: "DRY_RUN_VALIDATED", errorCode: null, errorMessageSafe: null, failureClass: null, nextAttemptAt: null });
      audit(db, { entityType: "publication_job", entityId: jobId, eventType: "DRY_RUN_EXECUTED", actor: workerId, metadata: {} });
    } else if (result.status === "BLOCKED_EXTERNAL") {
      updatePublicationJob(db, jobId, { status: "BLOCKED_EXTERNAL", errorCode: result.errorCode ?? "EXTERNAL_BLOCKER", errorMessageSafe: result.errorMessageSafe ?? "External publisher is blocked.", failureClass: "EXTERNAL_BLOCKER", nextAttemptAt: null });
      audit(db, { entityType: "publication_job", entityId: jobId, eventType: "PUBLICATION_BLOCKED", actor: workerId, metadata: { error_code: result.errorCode ?? null } });
    } else {
      const retryable = result.failureClass === "TRANSIENT" || result.failureClass === "RATE_LIMIT";
      const nextAttempt = retryable && job.attempt_count < job.max_attempts ? new Date(Date.now() + Math.min(60 * 60 * 1000, 2 ** job.attempt_count * 60 * 1000)).toISOString() : null;
      updatePublicationJob(db, jobId, { status: nextAttempt ? "QUEUED" : "PUBLISH_FAILED", errorCode: result.errorCode ?? "PUBLISH_FAILED", errorMessageSafe: result.errorMessageSafe ?? "Publication failed.", failureClass: result.failureClass ?? "PERMANENT", nextAttemptAt: nextAttempt });
      audit(db, { entityType: "publication_job", entityId: jobId, eventType: "PUBLICATION_FAILED", actor: workerId, metadata: { retry_scheduled: Boolean(nextAttempt), failure_class: result.failureClass ?? null } });
    }
    const updated = publicationJobById(db, jobId);
    if (!updated) throw new Error("PUBLICATION_JOB_NOT_FOUND");
    return jobView(updated);
  } finally { db.close(); }
}

export function publicationJobRow(jobId: string, config: MediaConfig = loadConfig()): Record<string, unknown> {
  const db = openDatabase(config);
  try {
    const row = publicationJobById(db, jobId);
    if (!row) throw new Error("PUBLICATION_JOB_NOT_FOUND");
    return row;
  } finally { db.close(); }
}
