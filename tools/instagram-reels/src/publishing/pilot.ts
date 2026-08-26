import crypto from "node:crypto";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { loadConfig, type MediaConfig } from "../config/index.js";
import { isRealPilotEnvironmentReady, loadAutomationConfig, runtimeEnvironmentValue } from "../config/automation.js";
import { derivedReelById, inspectAsset, latestEditorialPackage, openDatabase } from "../database/db.js";
import { sha256File } from "../media/checksum.js";
import { listReviewItems, type ReviewItem } from "../review/service.js";
import { evaluateContentReadiness, type ContentReadiness } from "../review/readiness.js";
import { resolveReviewFile } from "../review/files.js";
import { assertFileInsideRoot } from "../security/paths.js";
import { audit } from "./audit.js";
import { DryRunPublicationMediaProvider, type PublicationMediaProvider } from "./media-provider.js";
import { MetaPilotApi, MetaPilotApiError, type MetaContainerStatus, type MetaPublicationReadback } from "./meta-pilot-api.js";
import { validateTemporaryMediaUrl, type MediaUrlValidation } from "./temporary-media.js";

export const PILOT_CONFIRMATION = "I_CONFIRM_ONE_REEL_PUBLICATION" as const;
export const PILOT_SNAPSHOT_VERSION = "section10.2-snapshot-v1" as const;

export type PilotStatus = "FROZEN" | "INVALIDATED" | "PUBLISHED" | "FAILED" | "DRY_RUN_VALIDATED" | "AWAITING_HUMAN_CONTENT_READY";
export type PilotFailureCode = "CONTENT_READY_REQUIRED" | "TEMPORARY_MEDIA_PROVIDER_REQUIRED" | "MEDIA_PROVIDER_ERROR" | "MEDIA_URL_INVALID" | "CONTAINER_CREATION_ERROR" | "CONTAINER_PROCESSING_ERROR" | "CONTAINER_TIMEOUT" | "PUBLISH_PERMISSION_ERROR" | "MEDIA_PUBLISH_ERROR" | "META_READBACK_FAILED" | "RATE_LIMITED" | "TOKEN_EXPIRED" | "AUTHENTICATION_ERROR" | "CONTENT_READY_REVOKED" | "SNAPSHOT_INVALIDATED" | "DUPLICATE_PUBLICATION_PREVENTED" | "META_API_ERROR" | "NETWORK_ERROR" | "CONFIRMATION_REQUIRED" | "REAL_PILOT_ENVIRONMENT_REQUIRED";

export type PilotSnapshot = {
  snapshot_id: string;
  snapshot_version: string;
  reel_id: string;
  song: string;
  collection: string;
  source_asset_id: string;
  source_relative_path: string;
  source_checksum: string;
  derived_reel_checksum: string;
  derived_reel_relative_path: string;
  cover_relative_path: string;
  editorial_version: number;
  title: string;
  caption: string;
  cta: string;
  hashtags: string[];
  bible_reference: string | null;
  cover_text: string;
  rights_status: string;
  editorial_review_status: string;
  bible_verification_status: string;
  technical_validation_status: string;
  content_ready_at: string;
  publication_key: string;
  target_account: string;
  pilot_selected_at: string;
  status: PilotStatus;
};

export type PilotSelection = { snapshot: PilotSnapshot | null; status: "SELECTED" | "AWAITING_HUMAN_CONTENT_READY"; candidates_considered: number };

export type PilotExecutionResult = {
  status: PilotStatus | "BLOCKED";
  failure_code?: PilotFailureCode;
  snapshot: PilotSnapshot;
  readiness: ContentReadiness;
  media_url: MediaUrlValidation | null;
  container_id: string | null;
  remote_status: MetaContainerStatus | null;
  instagram_media_id: string | null;
  permalink: string | null;
  published_at: string | null;
  media_container_created: boolean;
  media_publish_called: boolean;
  content_published: boolean;
  publishing_proven: boolean;
  temporary_media_cleanup?: "NOT_REQUESTED" | "SUCCEEDED" | "PENDING";
};

type Row = Record<string, unknown>;
type PilotApi = Pick<MetaPilotApi, "createReelContainer" | "getContainerStatus" | "publishContainer" | "readPublication">;
type PilotExecutionOptions = {
  config: MediaConfig;
  snapshot: PilotSnapshot;
  readiness: ContentReadiness;
  actor: string;
  dryRun: boolean;
  mediaProvider?: PublicationMediaProvider;
  api?: PilotApi;
  validateUrl?: (url: string, dryRun?: boolean) => Promise<MediaUrlValidation>;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
};

function now(): string { return new Date().toISOString(); }
function safeTargetAccount(): string { return runtimeEnvironmentValue("INSTAGRAM_ACCOUNT_ID") ?? "dry-run-account"; }
function stablePublicationKey(snapshot: Pick<PilotSnapshot, "reel_id" | "editorial_version" | "derived_reel_checksum" | "target_account">): string {
  const input = `${snapshot.reel_id}\n${snapshot.editorial_version}\n${snapshot.derived_reel_checksum}\n${snapshot.target_account}`;
  return `instagram:${snapshot.reel_id}:${crypto.createHash("sha256").update(input).digest("hex").slice(0, 24)}`;
}

function rowValue(row: Row, key: string, fallback = ""): string { return row[key] === null || row[key] === undefined ? fallback : String(row[key]); }
function safeSnapshotJson(snapshot: PilotSnapshot): string { return JSON.stringify(snapshot); }

function writeSnapshot(db: DatabaseSync, snapshot: PilotSnapshot): void {
  const timestamp = now();
  db.prepare(`INSERT INTO pilot_snapshots (snapshot_id, reel_id, publication_key, snapshot_version, snapshot_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(publication_key) DO UPDATE SET snapshot_json = excluded.snapshot_json, status = excluded.status, updated_at = excluded.updated_at`).run(snapshot.snapshot_id, snapshot.reel_id, snapshot.publication_key, snapshot.snapshot_version, safeSnapshotJson(snapshot), snapshot.status, timestamp, timestamp);
}

function snapshotFromRow(row: Row | undefined): PilotSnapshot | null {
  if (!row?.snapshot_json) return null;
  try { return JSON.parse(String(row.snapshot_json)) as PilotSnapshot; } catch { return null; }
}

function publicationRow(db: DatabaseSync, key: string): Row | undefined { return db.prepare("SELECT * FROM pilot_publications WHERE publication_key = ?").get(key) as Row | undefined; }

function auditPilot(db: DatabaseSync, eventType: string, snapshot: PilotSnapshot, actor: string, metadata: Record<string, unknown> = {}): void {
  audit(db, { eventId: `section10.2:${eventType}:${snapshot.publication_key}`, entityType: "PILOT", entityId: snapshot.reel_id, eventType, actor: actor.trim() || "operator", metadata: { publication_key: snapshot.publication_key, snapshot_id: snapshot.snapshot_id, editorial_version: snapshot.editorial_version, source_checksum: snapshot.source_checksum, derived_reel_checksum: snapshot.derived_reel_checksum, ...metadata } });
}

async function fileChecksum(config: MediaConfig, root: string | null, relativePath: string): Promise<string> {
  if (!root) throw new Error("SOURCE_ROOT_NOT_CONFIGURED");
  const absolute = path.resolve(root, relativePath);
  await assertFileInsideRoot(root, absolute);
  return sha256File(absolute);
}

async function snapshotForItem(item: ReviewItem, readiness: ContentReadiness, config: MediaConfig, actor: string, persist = true): Promise<PilotSnapshot> {
  if (readiness.status !== "CONTENT_READY") throw new Error("CONTENT_READY_REQUIRED");
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  const db = openDatabase(config);
  try {
    const reel = derivedReelById(db, item.reel_id);
    const asset = inspectAsset(db, item.source_asset_id);
    const editorial = latestEditorialPackage(db, item.reel_id);
    if (!reel || !asset || !editorial || !asset.relative_path) throw new Error("PILOT_RECORD_NOT_FOUND");
    const output = await resolveReviewFile(config, String(reel.output_relative_path));
    const cover = await resolveReviewFile(config, String(editorial.cover_path));
    const sourceChecksum = await fileChecksum(config, config.mediaRoot, String(asset.relative_path));
    const expectedSourceChecksum = String(reel.source_checksum_before ?? "");
    if (!expectedSourceChecksum || sourceChecksum !== expectedSourceChecksum || sourceChecksum !== String(reel.source_checksum_after ?? "")) throw new Error("SOURCE_INTEGRITY_FAILED");
    const derivedChecksum = await sha256File(output.absolutePath);
    const targetAccount = safeTargetAccount();
    const candidate: PilotSnapshot = {
      snapshot_id: `pilot-snapshot-${randomUUID()}`, snapshot_version: PILOT_SNAPSHOT_VERSION, reel_id: item.reel_id,
      song: item.song_title, collection: item.collection, source_asset_id: item.source_asset_id, source_relative_path: String(asset.relative_path), source_checksum: sourceChecksum,
      derived_reel_checksum: derivedChecksum, derived_reel_relative_path: output.relativePath, cover_relative_path: cover.relativePath,
      editorial_version: Number(editorial.editorial_version), title: editorial.editorial_title, caption: editorial.caption, cta: editorial.cta,
      hashtags: [...editorial.hashtags], bible_reference: item.bible.reference, cover_text: editorial.cover_text, rights_status: String(reel.rights_status),
      editorial_review_status: editorial.review_status, bible_verification_status: item.bible.status, technical_validation_status: String(reel.validation_status),
      content_ready_at: readiness.evaluated_at, publication_key: "", target_account: targetAccount, pilot_selected_at: now(), status: "FROZEN",
    };
    candidate.publication_key = stablePublicationKey(candidate);
    if (persist) {
      const previous = db.prepare("SELECT * FROM pilot_snapshots WHERE reel_id = ? ORDER BY created_at DESC LIMIT 1").get(item.reel_id) as Row | undefined;
      const prior = snapshotFromRow(previous);
      if (prior && prior.publication_key === candidate.publication_key && prior.status !== "INVALIDATED") return prior;
      if (prior && prior.publication_key !== candidate.publication_key && prior.status === "FROZEN") {
        db.prepare("UPDATE pilot_snapshots SET status = 'INVALIDATED', updated_at = ? WHERE snapshot_id = ?").run(now(), prior.snapshot_id);
        auditPilot(db, "PILOT_ABORTED", { ...prior, status: "INVALIDATED" }, actor, { reason: "SNAPSHOT_REPLACED" });
      }
      writeSnapshot(db, candidate);
      auditPilot(db, "PILOT_SELECTED", candidate, actor, { selection: "CONTENT_READY_PRIMARY" });
      auditPilot(db, "PILOT_SNAPSHOT_CREATED", candidate, actor);
    }
    return candidate;
  } finally { db.close(); }
}

export async function selectPilotCandidate(config: MediaConfig = loadConfig()): Promise<PilotSelection> {
  const fast = await listReviewItems("fast-path", {}, config);
  const standard = await listReviewItems("standard-review", {}, config);
  const candidates = [...fast, ...standard];
  const ready: Array<{ item: ReviewItem; readiness: ContentReadiness }> = [];
  for (const item of candidates) {
    const readiness = await evaluateContentReadiness(item.reel_id, config);
    if (readiness.status === "CONTENT_READY") ready.push({ item, readiness });
  }
  ready.sort((left, right) => {
    const fastWeight = (right.item.section8_calibration?.review_queue === "FAST_PATH" ? 1 : 0) - (left.item.section8_calibration?.review_queue === "FAST_PATH" ? 1 : 0);
    return fastWeight || (right.item.section8_calibration?.editorial_quality_score ?? 0) - (left.item.section8_calibration?.editorial_quality_score ?? 0) || (right.item.section8_calibration?.specificity_score ?? 0) - (left.item.section8_calibration?.specificity_score ?? 0) || left.item.reel_id.localeCompare(right.item.reel_id);
  });
  if (!ready[0]) return { snapshot: null, status: "AWAITING_HUMAN_CONTENT_READY", candidates_considered: candidates.length };
  return { snapshot: await snapshotForItem(ready[0].item, ready[0].readiness, config, "pilot-selector"), status: "SELECTED", candidates_considered: candidates.length };
}

export async function freezePilotSnapshot(reelId: string, actor: string, config: MediaConfig): Promise<PilotSnapshot> {
  const item = [...await listReviewItems("fast-path", {}, config), ...await listReviewItems("standard-review", {}, config)].find((candidate) => candidate.reel_id === reelId);
  if (!item) throw new Error("PRIMARY_REEL_NOT_FOUND");
  const readiness = await evaluateContentReadiness(reelId, config);
  return snapshotForItem(item, readiness, config, actor);
}

export async function validatePilotSnapshot(snapshot: PilotSnapshot, config: MediaConfig): Promise<{ valid: boolean; reason?: PilotFailureCode }> {
  const readiness = await evaluateContentReadiness(snapshot.reel_id, config);
  if (readiness.status !== "CONTENT_READY") return { valid: false, reason: "CONTENT_READY_REVOKED" };
  const item = [...await listReviewItems("fast-path", {}, config), ...await listReviewItems("standard-review", {}, config)].find((candidate) => candidate.reel_id === snapshot.reel_id);
  if (!item) return { valid: false, reason: "SNAPSHOT_INVALIDATED" };
  try {
    const current = await snapshotForItem(item, readiness, config, "snapshot-validator", false);
    return current.publication_key === snapshot.publication_key && current.editorial_version === snapshot.editorial_version && current.derived_reel_checksum === snapshot.derived_reel_checksum ? { valid: true } : { valid: false, reason: "SNAPSHOT_INVALIDATED" };
  } catch { return { valid: false, reason: "SNAPSHOT_INVALIDATED" }; }
}

async function waitForContainer(api: PilotApi, containerId: string, intervalMs: number, timeoutMs: number): Promise<MetaContainerStatus> {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const status = await api.getContainerStatus(containerId);
    if (status.status !== "IN_PROGRESS") return status.status;
    if (intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return "IN_PROGRESS";
}

export async function executeFrozenPilot(options: PilotExecutionOptions): Promise<PilotExecutionResult> {
  const { snapshot, readiness, config } = options;
  if (readiness.status !== "CONTENT_READY") return { status: "BLOCKED", failure_code: "CONTENT_READY_REVOKED", snapshot, readiness, media_url: null, container_id: null, remote_status: null, instagram_media_id: null, permalink: null, published_at: null, media_container_created: false, media_publish_called: false, content_published: false, publishing_proven: false };
  const validation = await validatePilotSnapshot(snapshot, config);
  if (!validation.valid) return { status: "BLOCKED", failure_code: validation.reason ?? "SNAPSHOT_INVALIDATED", snapshot: { ...snapshot, status: "INVALIDATED" }, readiness, media_url: null, container_id: null, remote_status: null, instagram_media_id: null, permalink: null, published_at: null, media_container_created: false, media_publish_called: false, content_published: false, publishing_proven: false };
  const db = openDatabase(config);
  let mediaContainerCreated = false;
  let mediaPublishCalled = false;
  let containerId: string | null = null;
  let remoteStatus: MetaContainerStatus | null = null;
  try {
    const existing = publicationRow(db, snapshot.publication_key);
    if (existing?.status === "PUBLISHED") {
      auditPilot(db, "DUPLICATE_PUBLICATION_PREVENTED", snapshot, options.actor);
      return { status: "FAILED", failure_code: "DUPLICATE_PUBLICATION_PREVENTED", snapshot, readiness, media_url: null, container_id: rowValue(existing, "container_id") || null, remote_status: rowValue(existing, "remote_status") as MetaContainerStatus || null, instagram_media_id: rowValue(existing, "instagram_media_id") || null, permalink: rowValue(existing, "permalink") || null, published_at: rowValue(existing, "published_at") || null, media_container_created: Boolean(existing.container_id), media_publish_called: false, content_published: true, publishing_proven: true };
    }
    if (existing && ["UNCERTAIN", "PROCESSING_REMOTE", "PUBLISHING"].includes(String(existing.status))) return { status: "BLOCKED", failure_code: "DUPLICATE_PUBLICATION_PREVENTED", snapshot, readiness, media_url: null, container_id: rowValue(existing, "container_id") || null, remote_status: rowValue(existing, "remote_status") as MetaContainerStatus || null, instagram_media_id: null, permalink: null, published_at: null, media_container_created: Boolean(existing.container_id), media_publish_called: String(existing.status) === "PUBLISHING", content_published: false, publishing_proven: false };
    const provider = options.mediaProvider ?? (options.dryRun ? new DryRunPublicationMediaProvider() : null);
    if (!provider) return { status: "BLOCKED", failure_code: "TEMPORARY_MEDIA_PROVIDER_REQUIRED", snapshot, readiness, media_url: null, container_id: null, remote_status: null, instagram_media_id: null, permalink: null, published_at: null, media_container_created: false, media_publish_called: false, content_published: false, publishing_proven: false };
    let media: Awaited<ReturnType<PublicationMediaProvider["getTemporaryPublicUrl"]>>;
    try { media = await provider.getTemporaryPublicUrl(snapshot.reel_id); } catch { return { status: "BLOCKED", failure_code: "MEDIA_PROVIDER_ERROR", snapshot, readiness, media_url: null, container_id: null, remote_status: null, instagram_media_id: null, permalink: null, published_at: null, media_container_created: false, media_publish_called: false, content_published: false, publishing_proven: false }; }
    const mediaUrl = options.validateUrl ? await options.validateUrl(media.url, options.dryRun) : await validateTemporaryMediaUrl(media.url, undefined, options.dryRun);
    if (!mediaUrl.ok || (!options.dryRun && (media.checksumSha256 !== snapshot.derived_reel_checksum || !media.expiresAt || Number.isNaN(Date.parse(media.expiresAt)) || Date.parse(media.expiresAt) <= Date.now()))) return { status: "BLOCKED", failure_code: "MEDIA_URL_INVALID", snapshot, readiness, media_url: mediaUrl, container_id: null, remote_status: null, instagram_media_id: null, permalink: null, published_at: null, media_container_created: false, media_publish_called: false, content_published: false, publishing_proven: false };
    auditPilot(db, "PUBLICATION_PILOT_STARTED", snapshot, options.actor, { provider: media.provider });
    auditPilot(db, "TEMP_MEDIA_REFRESHED", snapshot, options.actor, { provider: media.provider, media_url: mediaUrl.safeUrl });
    if (options.dryRun) return { status: "DRY_RUN_VALIDATED", snapshot, readiness, media_url: mediaUrl, container_id: null, remote_status: null, instagram_media_id: null, permalink: null, published_at: null, media_container_created: false, media_publish_called: false, content_published: false, publishing_proven: false };
    const automation = loadAutomationConfig(process.env, config.repoRoot);
    if (!isRealPilotEnvironmentReady(automation)) return { status: "BLOCKED", failure_code: "REAL_PILOT_ENVIRONMENT_REQUIRED", snapshot, readiness, media_url: mediaUrl, container_id: null, remote_status: null, instagram_media_id: null, permalink: null, published_at: null, media_container_created: false, media_publish_called: false, content_published: false, publishing_proven: false };
    if (!options.api) throw new Error("META_PILOT_API_REQUIRED");
    const container = await options.api.createReelContainer({ videoUrl: media.url, caption: snapshot.caption });
    containerId = container.containerId;
    mediaContainerCreated = true;
    db.prepare("INSERT INTO pilot_publications (publication_key, snapshot_id, reel_id, status, attempt_count, container_id, container_created_at, created_at, updated_at) VALUES (?, ?, ?, 'PROCESSING_REMOTE', 1, ?, ?, ?, ?)").run(snapshot.publication_key, snapshot.snapshot_id, snapshot.reel_id, container.containerId, now(), now(), now());
    auditPilot(db, "MEDIA_CONTAINER_CREATED", snapshot, options.actor, { container_id: container.containerId });
    remoteStatus = await waitForContainer(options.api, container.containerId, options.pollIntervalMs ?? 5000, options.pollTimeoutMs ?? 120000);
    db.prepare("UPDATE pilot_publications SET remote_status = ?, last_checked_at = ?, updated_at = ? WHERE publication_key = ?").run(remoteStatus, now(), now(), snapshot.publication_key);
    if (remoteStatus !== "FINISHED") { db.prepare("UPDATE pilot_publications SET status = 'FAILED', error_code = ?, updated_at = ? WHERE publication_key = ?").run(remoteStatus === "IN_PROGRESS" ? "CONTAINER_TIMEOUT" : "CONTAINER_PROCESSING_ERROR", now(), snapshot.publication_key); auditPilot(db, "PILOT_ABORTED", snapshot, options.actor, { reason: remoteStatus === "IN_PROGRESS" ? "CONTAINER_TIMEOUT" : "CONTAINER_PROCESSING_ERROR" }); return { status: "FAILED", failure_code: remoteStatus === "IN_PROGRESS" ? "CONTAINER_TIMEOUT" : "CONTAINER_PROCESSING_ERROR", snapshot, readiness, media_url: mediaUrl, container_id: container.containerId, remote_status: remoteStatus, instagram_media_id: null, permalink: null, published_at: null, media_container_created: true, media_publish_called: false, content_published: false, publishing_proven: false }; }
    auditPilot(db, "MEDIA_CONTAINER_READY", snapshot, options.actor, { container_id: container.containerId });
    auditPilot(db, "META_CONTAINER_FINISHED", snapshot, options.actor, { container_id: container.containerId });
    const finalReadiness = await evaluateContentReadiness(snapshot.reel_id, config);
    const finalSnapshot = await validatePilotSnapshot(snapshot, config);
    if (finalReadiness.status !== "CONTENT_READY" || !finalSnapshot.valid) {
      db.prepare("UPDATE pilot_publications SET status = 'FAILED', error_code = ?, updated_at = ? WHERE publication_key = ?").run(finalReadiness.status !== "CONTENT_READY" ? "CONTENT_READY_REVOKED" : "SNAPSHOT_INVALIDATED", now(), snapshot.publication_key);
      auditPilot(db, "PILOT_ABORTED", snapshot, options.actor, { reason: finalReadiness.status !== "CONTENT_READY" ? "CONTENT_READY_REVOKED" : "SNAPSHOT_INVALIDATED" });
      return { status: "BLOCKED", failure_code: finalReadiness.status !== "CONTENT_READY" ? "CONTENT_READY_REVOKED" : "SNAPSHOT_INVALIDATED", snapshot, readiness: finalReadiness, media_url: mediaUrl, container_id: container.containerId, remote_status: "FINISHED", instagram_media_id: null, permalink: null, published_at: null, media_container_created: true, media_publish_called: false, content_published: false, publishing_proven: false };
    }
    db.prepare("UPDATE pilot_publications SET status = 'PUBLISHING', updated_at = ? WHERE publication_key = ?").run(now(), snapshot.publication_key);
    auditPilot(db, "MEDIA_PUBLISH_STARTED", snapshot, options.actor, { container_id: container.containerId });
    mediaPublishCalled = true;
    const published = await options.api.publishContainer(container.containerId);
    const readback: MetaPublicationReadback = await options.api.readPublication(published.mediaId);
    if (readback.id !== published.mediaId || !readback.permalink || (readback.media_product_type && readback.media_product_type.toUpperCase() !== "REELS") || (readback.username && readback.username !== "vargen.fe")) throw new MetaPilotApiError("META_READBACK_FAILED", "Instagram read-back did not confirm the expected Reel.");
    const publishedAt = readback.timestamp ?? now();
    db.prepare("UPDATE pilot_publications SET status = 'PUBLISHED', remote_status = 'FINISHED', instagram_media_id = ?, permalink = ?, published_at = ?, updated_at = ? WHERE publication_key = ?").run(published.mediaId, readback.permalink ?? null, publishedAt, now(), snapshot.publication_key);
    auditPilot(db, "MEDIA_PUBLISH_SUCCEEDED", snapshot, options.actor, { container_id: container.containerId, instagram_media_id: published.mediaId });
    auditPilot(db, "PUBLICATION_CONFIRMED", snapshot, options.actor, { instagram_media_id: published.mediaId, permalink: readback.permalink ?? null });
    auditPilot(db, "META_READBACK_CONFIRMED", snapshot, options.actor, { instagram_media_id: published.mediaId, permalink: readback.permalink ?? null });
    let temporaryMediaCleanup: "SUCCEEDED" | "PENDING" | "NOT_REQUESTED" = "NOT_REQUESTED";
    if (options.mediaProvider) {
      try {
        await options.mediaProvider.revokeTemporaryPublicUrl(snapshot.reel_id, media.url);
        temporaryMediaCleanup = "SUCCEEDED";
        auditPilot(db, "TEMP_MEDIA_CLEANUP_SUCCEEDED", snapshot, options.actor, { provider: media.provider });
      } catch {
        temporaryMediaCleanup = "PENDING";
        auditPilot(db, "TEMP_MEDIA_CLEANUP_PENDING", snapshot, options.actor, { provider: media.provider });
      }
    }
    db.prepare("UPDATE pilot_snapshots SET status = 'PUBLISHED', updated_at = ? WHERE snapshot_id = ?").run(now(), snapshot.snapshot_id);
    return { status: "PUBLISHED", snapshot: { ...snapshot, status: "PUBLISHED" }, readiness, media_url: mediaUrl, container_id: container.containerId, remote_status: "FINISHED", instagram_media_id: published.mediaId, permalink: readback.permalink ?? null, published_at: publishedAt, media_container_created: true, media_publish_called: true, content_published: true, publishing_proven: true, temporary_media_cleanup: temporaryMediaCleanup };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meta pilot operation failed.";
    const errorCode = error instanceof MetaPilotApiError ? error.code : "";
    const code: PilotFailureCode = errorCode === "AUTHENTICATION_ERROR" ? "AUTHENTICATION_ERROR" : errorCode === "RATE_LIMITED" ? "RATE_LIMITED" : errorCode === "MEDIA_PUBLISH_ERROR" ? "MEDIA_PUBLISH_ERROR" : errorCode === "CONTAINER_CREATION_ERROR" ? "CONTAINER_CREATION_ERROR" : errorCode === "META_READBACK_FAILED" ? "META_READBACK_FAILED" : message.includes("AUTH") ? "AUTHENTICATION_ERROR" : "META_API_ERROR";
    auditPilot(db, "MEDIA_PUBLISH_FAILED", snapshot, options.actor, { error_code: code });
    if (mediaContainerCreated) db.prepare("UPDATE pilot_publications SET status = ?, error_code = ?, error_message_safe = ?, updated_at = ? WHERE publication_key = ?").run(mediaPublishCalled ? "UNCERTAIN" : "FAILED", code, "Pilot remote state requires reconciliation before retry.", now(), snapshot.publication_key);
    db.prepare("UPDATE pilot_snapshots SET status = 'FAILED', updated_at = ? WHERE snapshot_id = ?").run(now(), snapshot.snapshot_id);
    return { status: "FAILED", failure_code: code, snapshot, readiness, media_url: null, container_id: containerId, remote_status: remoteStatus, instagram_media_id: null, permalink: null, published_at: null, media_container_created: mediaContainerCreated, media_publish_called: mediaPublishCalled, content_published: false, publishing_proven: false };
  } finally { db.close(); }
}

export async function runPilotDryRun(reelId: string | undefined, actor: string, config: MediaConfig): Promise<{ selection: PilotSelection; result?: PilotExecutionResult }> {
  const selection = reelId ? { snapshot: await freezePilotSnapshot(reelId, actor, config), status: "SELECTED" as const, candidates_considered: 1 } : await selectPilotCandidate(config);
  if (!selection.snapshot) return { selection };
  const readiness = await evaluateContentReadiness(selection.snapshot.reel_id, config);
  return { selection, result: await executeFrozenPilot({ config, snapshot: selection.snapshot, readiness, actor, dryRun: true }) };
}
