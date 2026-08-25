import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { MediaConfig } from "../config/index.js";
import { derivedReelsForAsset, inspectAsset, openDatabase } from "../database/db.js";
import { audit } from "../publishing/audit.js";
import type { ReviewItem, ReviewFilters } from "./service.js";
import { listReviewItems } from "./service.js";
import { evaluateContentReadiness, type ContentReadiness } from "./readiness.js";

export type ReviewSessionQueue = "FAST_PATH" | "STANDARD_REVIEW";
export type ReviewSession = {
  session_id: string;
  reviewer: string;
  started_at: string;
  ended_at: string | null;
  queue: ReviewSessionQueue;
  current_reel_id: string | null;
  reviewed_count: number;
  approved_count: number;
  rejected_count: number;
  needs_changes_count: number;
  content_ready_count: number;
  last_action_at: string;
  filters: ReviewFilters;
};

export type ReviewSessionProgress = ReviewSession & {
  total: number;
  pending: number;
  bible_verified: number;
  rights_confirmed: number;
  next_reel_id: string | null;
};

type SessionRow = Record<string, unknown>;

function now(): string { return new Date().toISOString(); }
function sessionId(): string { return `review-session-${crypto.randomUUID()}`; }
function stringValue(value: unknown, fallback = ""): string { return value === null || value === undefined ? fallback : String(value); }
function numberValue(value: unknown): number { const result = Number(value); return Number.isFinite(result) ? result : 0; }

function parseFilters(value: unknown): ReviewFilters {
  try { return JSON.parse(stringValue(value, "{}")) as ReviewFilters; } catch { return {}; }
}

function toSession(row: SessionRow): ReviewSession {
  return {
    session_id: stringValue(row.session_id), reviewer: stringValue(row.reviewer), started_at: stringValue(row.started_at),
    ended_at: row.ended_at ? stringValue(row.ended_at) : null,
    queue: stringValue(row.queue) as ReviewSessionQueue, current_reel_id: row.current_reel_id ? stringValue(row.current_reel_id) : null,
    reviewed_count: numberValue(row.reviewed_count), approved_count: numberValue(row.approved_count), rejected_count: numberValue(row.rejected_count),
    needs_changes_count: numberValue(row.needs_changes_count), content_ready_count: numberValue(row.content_ready_count),
    last_action_at: stringValue(row.last_action_at), filters: parseFilters(row.filters_json),
  };
}

function queueMatches(item: ReviewItem, queue: ReviewSessionQueue): boolean {
  return item.section8_calibration?.review_queue === queue;
}

export function selectNextPendingItem(items: ReviewItem[], queue: ReviewSessionQueue, currentReelId?: string | null): ReviewItem | null {
  return items.find((item) => queueMatches(item, queue) && item.reel_id !== currentReelId && item.editorial?.review_status === "READY_FOR_HUMAN_REVIEW") ?? null;
}

async function sessionItems(session: ReviewSession, config: MediaConfig): Promise<ReviewItem[]> {
  const items = await listReviewItems("primary", session.filters, config);
  return items.filter((item) => queueMatches(item, session.queue));
}

async function calculateSessionProgress(session: ReviewSession, config: MediaConfig, currentOverride?: string | null): Promise<ReviewSessionProgress> {
  const items = await sessionItems(session, config);
  const reviewed = items.filter((item) => item.editorial?.review_status && item.editorial.review_status !== "READY_FOR_HUMAN_REVIEW");
  const readiness = await Promise.all(items.map((item) => evaluateContentReadiness(item.reel_id, config)));
  const next = selectNextPendingItem(items, session.queue, currentOverride ?? session.current_reel_id);
  return {
    ...session,
    current_reel_id: currentOverride === undefined ? session.current_reel_id : currentOverride,
    reviewed_count: reviewed.length,
    approved_count: items.filter((item) => item.editorial?.review_status === "APPROVED").length,
    rejected_count: items.filter((item) => item.editorial?.review_status === "REJECTED").length,
    needs_changes_count: items.filter((item) => item.editorial?.review_status === "NEEDS_CHANGES").length,
    content_ready_count: readiness.filter((item) => item.status === "CONTENT_READY").length,
    total: items.length,
    pending: items.length - reviewed.length,
    bible_verified: items.filter((item) => item.bible.status === "VERIFIED").length,
    rights_confirmed: items.filter((item) => item.rights_status === "RIGHTS_CONFIRMED").length,
    next_reel_id: next?.reel_id ?? null,
  };
}

async function persistProgress(progress: ReviewSessionProgress, config: MediaConfig): Promise<void> {
  const db = openDatabase(config);
  try {
    db.prepare(`UPDATE review_sessions SET current_reel_id = ?, reviewed_count = ?, approved_count = ?, rejected_count = ?, needs_changes_count = ?, content_ready_count = ?, last_action_at = ? WHERE session_id = ?`).run(
      progress.current_reel_id, progress.reviewed_count, progress.approved_count, progress.rejected_count, progress.needs_changes_count, progress.content_ready_count, now(), progress.session_id,
    );
  } finally { db.close(); }
}

export function startReviewSession(queue: ReviewSessionQueue, reviewer: string, filters: ReviewFilters = {}, config: MediaConfig): ReviewSession {
  if (!reviewer.trim()) throw new Error("REVIEWER_REQUIRED");
  const timestamp = now();
  const value: ReviewSession = { session_id: sessionId(), reviewer: reviewer.trim(), started_at: timestamp, ended_at: null, queue, current_reel_id: null, reviewed_count: 0, approved_count: 0, rejected_count: 0, needs_changes_count: 0, content_ready_count: 0, last_action_at: timestamp, filters };
  const db = openDatabase(config);
  try {
    db.prepare(`INSERT INTO review_sessions (session_id, reviewer, started_at, ended_at, queue, current_reel_id, reviewed_count, approved_count, rejected_count, needs_changes_count, content_ready_count, last_action_at, filters_json) VALUES (?, ?, ?, NULL, ?, NULL, 0, 0, 0, 0, 0, ?, ?)`)
      .run(value.session_id, value.reviewer, value.started_at, value.queue, value.last_action_at, JSON.stringify(filters));
    audit(db, { eventId: `section9-session-started:${value.session_id}`, entityType: "REVIEW_SESSION", entityId: value.session_id, eventType: "REVIEW_SESSION_STARTED", actor: value.reviewer, metadata: { queue, filters } });
    return value;
  } finally { db.close(); }
}

export function getReviewSession(sessionIdValue: string, config: MediaConfig): ReviewSession | undefined {
  const db = openDatabase(config);
  try { const row = db.prepare("SELECT * FROM review_sessions WHERE session_id = ?").get(sessionIdValue) as SessionRow | undefined; return row ? toSession(row) : undefined; } finally { db.close(); }
}

export async function getReviewSessionProgress(sessionIdValue: string, config: MediaConfig): Promise<ReviewSessionProgress> {
  const session = getReviewSession(sessionIdValue, config);
  if (!session) throw new Error("REVIEW_SESSION_NOT_FOUND");
  return calculateSessionProgress(session, config);
}

export async function nextReviewItem(sessionIdValue: string, config: MediaConfig): Promise<{ item: ReviewItem | null; session: ReviewSessionProgress }> {
  const session = getReviewSession(sessionIdValue, config);
  if (!session) throw new Error("REVIEW_SESSION_NOT_FOUND");
  if (session.ended_at) throw new Error("REVIEW_SESSION_ENDED");
  const items = await sessionItems(session, config);
  const item = selectNextPendingItem(items, session.queue, session.current_reel_id);
  const progress = await calculateSessionProgress(session, config, item?.reel_id ?? null);
  await persistProgress(progress, config);
  return { item, session: { ...progress, current_reel_id: item?.reel_id ?? null, next_reel_id: item?.reel_id ?? null } };
}

export async function recordReviewSessionAction(sessionIdValue: string, reelId: string, action: string, config: MediaConfig): Promise<ReviewSessionProgress> {
  const session = getReviewSession(sessionIdValue, config);
  if (!session) throw new Error("REVIEW_SESSION_NOT_FOUND");
  if (session.ended_at) throw new Error("REVIEW_SESSION_ENDED");
  const db = openDatabase(config);
  try {
    audit(db, { eventId: `section9-session-action:${sessionIdValue}:${reelId}:${action}`, entityType: "REVIEW_SESSION", entityId: sessionIdValue, eventType: "REVIEW_SESSION_ACTION", actor: session.reviewer, metadata: { reel_id: reelId, action } });
  } finally { db.close(); }
  const progress = await calculateSessionProgress(session, config, reelId);
  await persistProgress(progress, config);
  return progress;
}

export function endReviewSession(sessionIdValue: string, actor: string, config: MediaConfig): ReviewSession {
  if (!actor.trim()) throw new Error("REVIEWER_REQUIRED");
  const timestamp = now();
  const db = openDatabase(config);
  try {
    const row = db.prepare("SELECT * FROM review_sessions WHERE session_id = ?").get(sessionIdValue) as SessionRow | undefined;
    if (!row) throw new Error("REVIEW_SESSION_NOT_FOUND");
    db.prepare("UPDATE review_sessions SET ended_at = ?, last_action_at = ? WHERE session_id = ?").run(timestamp, timestamp, sessionIdValue);
    audit(db, { eventId: `section9-session-ended:${sessionIdValue}:${timestamp.slice(0, 10)}`, entityType: "REVIEW_SESSION", entityId: sessionIdValue, eventType: "REVIEW_SESSION_ENDED", actor: actor.trim(), metadata: {} });
    return toSession({ ...row, ended_at: timestamp, last_action_at: timestamp });
  } finally { db.close(); }
}

export function rightsDryRunPreview(assetIds: string[], config: MediaConfig): Record<string, unknown> {
  const unique = [...new Set(assetIds.map((value) => value.trim()).filter(Boolean))];
  const db = openDatabase(config);
  try {
    const sources = unique.map((assetId) => {
      const asset = inspectAsset(db, assetId);
      const derived = asset ? derivedReelsForAsset(db, assetId) : [];
      return { asset_id: assetId, exists: Boolean(asset), rights_status: asset ? stringValue(asset.rights_status) : null, derived_reel_count: derived.length, derived_reel_ids: derived.map((row) => stringValue(row.reel_id)), proposed_rights_status: "RIGHTS_CONFIRMED" };
    });
    return { dry_run: true, statement_required: true, source_count: sources.length, derived_reel_count: sources.reduce((sum, item) => sum + Number(item.derived_reel_count), 0), sources };
  } finally { db.close(); }
}

export async function recalculateReadinessForSource(assetId: string, config: MediaConfig): Promise<ContentReadiness[]> {
  const db = openDatabase(config);
  let reelIds: string[];
  try { reelIds = derivedReelsForAsset(db, assetId).map((row) => stringValue(row.reel_id)); } finally { db.close(); }
  return Promise.all(reelIds.map((reelId) => evaluateContentReadiness(reelId, config)));
}

type ManifestItem = {
  reel_id: string; song: string; collection: string; video_path: string; cover_path: string | null; editorial_version: number | null; caption: string | null; cta: string | null; hashtags: string[]; bible_reference: string | null; rights_provenance: { source_asset_id: string; rights_status: string }; technical_validation: string; content_ready_at: string;
};

export async function writeSection9ReviewProgressReport(config: MediaConfig): Promise<{ jsonPath: string; htmlPath: string }> {
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  const items = await listReviewItems("primary", {}, config);
  const readiness = await Promise.all(items.map((item) => evaluateContentReadiness(item.reel_id, config)));
  const readinessById = new Map(readiness.map((item) => [item.reel_id, item]));
  const queue = (queueName: ReviewSessionQueue) => items.filter((item) => item.section8_calibration?.review_queue === queueName);
  const reviewed = items.filter((item) => item.editorial?.review_status !== "READY_FOR_HUMAN_REVIEW");
  const report = {
    generated_at: now(), queue: "PRIMARY", primary_total: items.length, fast_path: queue("FAST_PATH").length, standard_review: queue("STANDARD_REVIEW").length,
    human_reviewed: reviewed.length, bible_verified: items.filter((item) => item.bible.status === "VERIFIED").length, editorial_approved: items.filter((item) => item.editorial?.review_status === "APPROVED").length,
    rights_confirmed: items.filter((item) => item.rights_status === "RIGHTS_CONFIRMED").length, content_ready: readiness.filter((item) => item.status === "CONTENT_READY").length,
    rejected: items.filter((item) => item.editorial?.review_status === "REJECTED").length, needs_changes: items.filter((item) => item.editorial?.review_status === "NEEDS_CHANGES").length,
    pending: items.filter((item) => item.editorial?.review_status === "READY_FOR_HUMAN_REVIEW").length,
    by_collection: Object.fromEntries([...new Set(items.map((item) => item.collection))].sort().map((collection) => { const rows = items.filter((item) => item.collection === collection); return [collection, { total: rows.length, reviewed: rows.filter((item) => item.editorial?.review_status !== "READY_FOR_HUMAN_REVIEW").length, content_ready: rows.filter((item) => readinessById.get(item.reel_id)?.status === "CONTENT_READY").length }]; })),
  };
  const jsonPath = path.join(config.reelsOutputRoot, "section9-review-progress.json");
  const htmlPath = path.join(config.reelsOutputRoot, "section9-review-progress.html");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const esc = (value: unknown) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char));
  await fs.writeFile(htmlPath, `<!doctype html><meta charset="utf-8"><title>Section 9 review progress</title><style>body{font:16px system-ui;background:#111;color:#eee;max-width:1000px;margin:24px auto;padding:0 16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #444;padding:8px;text-align:left}</style><h1>Section 9 — progresso</h1><p>Primary: ${report.human_reviewed}/${report.primary_total} revisados · CONTENT_READY: ${report.content_ready}</p><table><tr><th>Collection</th><th>Total</th><th>Reviewed</th><th>CONTENT_READY</th></tr>${Object.entries(report.by_collection).map(([key, value]) => `<tr><td>${esc(key)}</td><td>${value.total}</td><td>${value.reviewed}</td><td>${value.content_ready}</td></tr>`).join("")}</table>`, "utf8");
  return { jsonPath, htmlPath };
}

export async function writeContentReadyManifest(config: MediaConfig): Promise<{ jsonPath: string; htmlPath: string; count: number }> {
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  const items = await listReviewItems("primary", {}, config);
  const ready: ManifestItem[] = [];
  for (const item of items) {
    const result = await evaluateContentReadiness(item.reel_id, config);
    if (result.status !== "CONTENT_READY" || !item.editorial) continue;
    ready.push({ reel_id: item.reel_id, song: item.song_title, collection: item.collection, video_path: item.output_relative_path, cover_path: item.cover_relative_path, editorial_version: result.editorial_version, caption: item.editorial.caption, cta: item.editorial.cta, hashtags: item.editorial.hashtags, bible_reference: item.bible.reference, rights_provenance: { source_asset_id: item.source_asset_id, rights_status: item.rights_status }, technical_validation: item.technical.validation_status, content_ready_at: result.evaluated_at });
  }
  const report = { generated_at: now(), status: "CONTENT_READY_ONLY", count: ready.length, items: ready };
  const jsonPath = path.join(config.reelsOutputRoot, "content-ready.json");
  const htmlPath = path.join(config.reelsOutputRoot, "content-ready.html");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const esc = (value: unknown) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char));
  await fs.writeFile(htmlPath, `<!doctype html><meta charset="utf-8"><title>Vargen & Fé — CONTENT_READY</title><style>body{font:16px system-ui;background:#111;color:#eee;max-width:1000px;margin:24px auto;padding:0 16px}article{border:1px solid #444;padding:12px;margin:12px 0}</style><h1>CONTENT_READY inventory</h1><p>${ready.length} Reel(s). Este inventário não publica nem agenda.</p>${ready.map((item) => `<article><h2>${esc(item.song)}</h2><p>${esc(item.collection)} · ${esc(item.reel_id)} · versão ${item.editorial_version}</p><p>${esc(item.bible_reference)} · ${esc(item.cta)}</p></article>`).join("")}`, "utf8");
  return { jsonPath, htmlPath, count: ready.length };
}
