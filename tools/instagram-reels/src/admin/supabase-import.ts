import fs from "node:fs";
import path from "node:path";
import type { MediaConfig } from "../config/index.js";
import { exportPath, exportSqliteGovernance } from "./sqlite-export.js";
import { loadProjectEnvironment } from "../config/index.js";
import { resolveAdminDataSource } from "../config/remote-admin.js";
import { resolveSupabaseConfiguration } from "../config/supabase.js";
import { collectRemoteSupabaseValidation } from "../cli/remote-migration.js";

export type ImportOptions = { apply: boolean; inputPath?: string };

type Row = Record<string, unknown>;
type ExportPayload = { manifest?: Record<string, unknown>; tables?: Record<string, Row[]> };

const TARGET_TABLES = [
  "media_assets", "derived_reels", "editorial_packages", "editorial_versions", "human_reviews",
  "bible_evidence", "bible_verifications", "rights_sources", "rights_confirmations",
  "content_ready_evaluations", "publication_records", "publication_audit", "analytics_snapshots",
  "review_sessions", "temporary_media_records",
] as const;

const CONFLICT_KEYS: Record<string, string[]> = {
  media_assets: ["asset_id"], derived_reels: ["reel_id"], editorial_packages: ["reel_id"],
  editorial_versions: ["reel_id", "editorial_version"], human_reviews: ["review_id"],
  bible_evidence: ["evidence_id"], bible_verifications: ["verification_id"], rights_sources: ["source_id"],
  rights_confirmations: ["confirmation_id"], content_ready_evaluations: ["evaluation_id"],
  publication_records: ["publication_key"], publication_audit: ["event_id"],
  analytics_snapshots: ["analytics_snapshot_id"], review_sessions: ["session_id"],
  temporary_media_records: ["publication_key"],
};

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  try { return JSON.parse(value); } catch { throw new Error("SUPABASE_IMPORT_INVALID_JSON"); }
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`SUPABASE_IMPORT_REQUIRED_FIELD:${field}`);
  return value;
}

function optionalText(value: unknown): string | null { return typeof value === "string" && value.trim() !== "" ? value : null; }
function asNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }

function sourceRows(payload: ExportPayload, table: string): Row[] {
  const rows = payload.tables?.[table];
  if (!Array.isArray(rows)) throw new Error(`SUPABASE_IMPORT_SOURCE_TABLE_MISSING:${table}`);
  return rows;
}

function actorIdFor(actor: unknown, adminProfileId: string): string | null { return actor === "Renan Gagliano" ? adminProfileId : null; }

function latestByReel(rows: Row[]): Map<string, Row> {
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const reelId = text(row.reel_id, "reel_id");
    const current = latest.get(reelId);
    if (!current || Number(row.editorial_version ?? 0) > Number(current.editorial_version ?? 0)) latest.set(reelId, row);
  }
  return latest;
}

function latestReadiness(rows: Row[]): Map<string, Row> {
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const reelId = text(row.reel_id, "reel_id");
    const current = latest.get(reelId);
    if (!current || String(row.evaluated_at ?? "") > String(current.evaluated_at ?? "")) latest.set(reelId, row);
  }
  return latest;
}

function buildRows(payload: ExportPayload, adminProfileId: string): Record<string, Row[]> {
  const assets = sourceRows(payload, "media_assets");
  const derived = sourceRows(payload, "derived_reels");
  const packages = sourceRows(payload, "reel_editorial_packages");
  const bible = sourceRows(payload, "bible_reference_sources");
  const rights = sourceRows(payload, "source_rights_history");
  const readiness = sourceRows(payload, "content_readiness");
  const snapshots = sourceRows(payload, "pilot_snapshots");
  const publications = sourceRows(payload, "pilot_publications");
  const audits = sourceRows(payload, "publication_audit_events");
  const analytics = sourceRows(payload, "instagram_analytics_snapshots");
  const sessions = sourceRows(payload, "review_sessions");
  const temporaryMedia = sourceRows(payload, "temporary_media");
  const latestPackages = latestByReel(packages);
  const latestReadinessRows = latestReadiness(readiness);
  const bibleByReel = new Map(bible.map((row) => [text(row.reel_id, "reel_id"), row]));

  const editorialVersions = packages.map((row) => ({
    reel_id: text(row.reel_id, "reel_id"), editorial_version: Number(row.editorial_version),
    title: text(row.editorial_title, "editorial_title"), hook: text(row.selected_hook, "selected_hook"),
    caption: text(row.caption, "caption"), cta: text(row.cta, "cta"), hashtags: parseJson(row.hashtags_json, []),
    primary_pillar: text(row.content_pillar, "content_pillar"), secondary_pillar: optionalText(row.secondary_pillar),
    cover_text: text(row.cover_text, "cover_text"), bible_reference: typeof row.bible_reference === "string" ? row.bible_reference : "",
    review_status: text(row.review_status, "review_status"), operator_review_note: optionalText(row.review_note),
    created_by: null, created_at: text(row.created_at, "created_at"),
  }));

  const editorialPackages = [...latestPackages.entries()].map(([reelId, row]) => ({
    reel_id: reelId, latest_editorial_version: Number(row.editorial_version), updated_at: text(row.updated_at, "updated_at"),
  }));

  const derivedReels = derived.map((row) => {
    const reelId = text(row.reel_id, "reel_id");
    const latest = latestPackages.get(reelId);
    const readinessRow = latestReadinessRows.get(reelId);
    const bibleRow = bibleByReel.get(reelId);
    return {
      reel_id: reelId, candidate_id: text(row.candidate_id, "candidate_id"), source_asset_id: text(row.source_asset_id, "source_asset_id"),
      output_relative_path: text(row.output_relative_path, "output_relative_path"), thumbnail_relative_path: optionalText(row.thumbnail_relative_path),
      file_size: asNumber(row.file_size), duration_ms: asNumber(row.duration_ms), width: asNumber(row.width), height: asNumber(row.height),
      validation_status: text(row.validation_status, "validation_status"), source_checksum_before: optionalText(row.source_checksum_before),
      source_checksum_after: optionalText(row.source_checksum_after), song_title: null, collection: null, tier: null, ai_score: null,
      editorial_quality: null, bible_status: bibleRow ? text(bibleRow.verification_status, "verification_status") : "MISSING",
      rights_status: text(row.rights_status, "rights_status"), editorial_status: latest ? optionalText(latest.review_status) : null,
      review_queue: null, content_pillar: latest ? optionalText(latest.content_pillar) : null, seasonality: null,
      content_ready: readinessRow?.status === "CONTENT_READY", publication_status: text(row.publication_status, "publication_status"),
      last_reviewed_at: latest ? optionalText(latest.reviewed_at) : null, created_at: text(row.created_at, "created_at"), updated_at: text(row.updated_at, "updated_at"),
    };
  });

  const bibleEvidence = bible.map((row) => ({
    evidence_id: text(row.bible_reference_id, "bible_reference_id"), reel_id: text(row.reel_id, "reel_id"), editorial_version: Number(row.editorial_version),
    reference: text(row.reference, "reference"), source_type: text(row.source_type, "source_type"), source_location: text(row.source_location, "source_location"),
    evidence_status: text(row.verification_status, "verification_status"), created_at: text(row.created_at, "created_at"), updated_at: text(row.updated_at, "updated_at"),
  }));

  const bibleVerifications = bible.filter((row) => actorIdFor(row.verified_by, adminProfileId) !== null).map((row) => ({
    verification_id: `verification:${text(row.bible_reference_id, "bible_reference_id")}`, evidence_id: text(row.bible_reference_id, "bible_reference_id"),
    reel_id: text(row.reel_id, "reel_id"), editorial_version: Number(row.editorial_version), verified_by: adminProfileId,
    verified_at: text(row.verified_at, "verified_at"), note: text(row.note, "note"),
  }));

  const rightsSources = rights.map((row) => ({
    source_id: `rights-source:${text(row.confirmation_id, "confirmation_id")}`, asset_id: text(row.asset_id, "asset_id"),
    source_type: "sqlite-source-rights-history", source_location: text(row.asset_id, "asset_id"), source_checksum: null,
    created_at: text(row.confirmed_at, "confirmed_at"),
  }));

  const rightsConfirmations = rights.map((row) => ({
    confirmation_id: text(row.confirmation_id, "confirmation_id"), source_id: `rights-source:${text(row.confirmation_id, "confirmation_id")}`,
    actor_id: actorIdFor(row.confirmed_by, adminProfileId), rights_status: text(row.rights_status, "rights_status"),
    confirmation_scope: text(row.confirmation_scope, "confirmation_scope"), statement_version: text(row.confirmation_statement_version, "confirmation_statement_version"),
    note: text(row.note, "note"), confirmed_at: text(row.confirmed_at, "confirmed_at"),
  }));

  const humanReviews = packages.filter((row) => row.review_status === "APPROVED").map((row) => ({
    review_id: `editorial-review:${text(row.reel_id, "reel_id")}:${Number(row.editorial_version)}`, reel_id: text(row.reel_id, "reel_id"),
    editorial_version: Number(row.editorial_version), actor_id: actorIdFor(row.reviewed_by, adminProfileId) ?? (() => { throw new Error("SUPABASE_IMPORT_REVIEW_ACTOR_UNMAPPED"); })(),
    status: text(row.review_status, "review_status"), note: text(row.review_note, "review_note"), created_at: text(row.reviewed_at, "reviewed_at"),
  }));

  const contentReadyEvaluations = readiness.map((row) => ({
    evaluation_id: `content-ready:${text(row.reel_id, "reel_id")}:${row.editorial_version ?? "none"}:${text(row.evaluated_at, "evaluated_at")}`,
    reel_id: text(row.reel_id, "reel_id"), editorial_version: row.editorial_version === null || row.editorial_version === undefined ? null : Number(row.editorial_version),
    status: text(row.status, "status"), gates: parseJson(row.gates_json, {}), reasons: parseJson(row.reasons_json, []), evaluated_at: text(row.evaluated_at, "evaluated_at"),
  }));

  const snapshotById = new Map(snapshots.map((row) => [text(row.snapshot_id, "snapshot_id"), row]));
  const publicationRecords = publications.map((row) => {
    const snapshot = snapshotById.get(text(row.snapshot_id, "snapshot_id"));
    const snapshotJson = snapshot ? parseJson(snapshot.snapshot_json, {}) as Row : {};
    return {
      publication_key: text(row.publication_key, "publication_key"), reel_id: text(row.reel_id, "reel_id"), editorial_version: Number(snapshotJson.editorial_version ?? 1),
      snapshot_id: optionalText(row.snapshot_id), status: text(row.status, "status"), container_id: optionalText(row.container_id),
      remote_media_id: optionalText(row.instagram_media_id), permalink: optionalText(row.permalink), published_at: optionalText(row.published_at),
      attempt_count: Number(row.attempt_count ?? 0), created_at: text(row.created_at, "created_at"), updated_at: text(row.updated_at, "updated_at"),
    };
  });

  const publicationAudit = audits.map((row) => {
    const metadata = parseJson(row.metadata_json_safe, {}) as Row;
    return { event_id: text(row.event_id, "event_id"), entity_type: text(row.entity_type, "entity_type"), entity_id: text(row.entity_id, "entity_id"),
      event_type: text(row.event_type, "event_type"), actor_id: actorIdFor(row.actor, adminProfileId), occurred_at: text(row.timestamp, "timestamp"),
      metadata: { ...metadata, source_actor: row.actor ?? null } };
  });

  const analyticsSnapshots = analytics.map((row) => ({
    analytics_snapshot_id: text(row.analytics_snapshot_id, "analytics_snapshot_id"), reel_id: text(row.reel_id, "reel_id"),
    publication_key: text(row.publication_key, "publication_key"), instagram_media_id: text(row.instagram_media_id, "instagram_media_id"),
    observation_window: text(row.observation_window, "observation_window"), captured_at: text(row.captured_at, "captured_at"), source_timestamp: optionalText(row.source_timestamp),
    api_version: text(row.api_version, "api_version"), status: text(row.status, "status"), metrics: parseJson(row.metrics_json, {}), created_at: text(row.created_at, "created_at"),
  }));

  const reviewSessions = sessions.map((row) => ({
    session_id: text(row.session_id, "session_id"), reviewer_id: actorIdFor(row.reviewer, adminProfileId) ?? (() => { throw new Error("SUPABASE_IMPORT_SESSION_ACTOR_UNMAPPED"); })(),
    queue: text(row.queue, "queue"), current_reel_id: optionalText(row.current_reel_id), started_at: text(row.started_at, "started_at"), ended_at: optionalText(row.ended_at),
    reviewed_count: Number(row.reviewed_count ?? 0), last_action_at: text(row.last_action_at, "last_action_at"), filters: parseJson(row.filters_json, {}),
  }));

  const temporaryMediaRecords = temporaryMedia.map((row) => ({
    publication_key: text(row.publication_key, "publication_key"), reel_id: text(row.reel_id, "reel_id"), provider: text(row.provider, "provider"),
    drive_id: optionalText(row.drive_id), item_id: optionalText(row.item_id), item_path: optionalText(row.item_path), checksum_sha256: text(row.derived_checksum, "derived_checksum"),
    size_bytes: Number(row.blob_size), validation_status: text(row.status, "status"), cleanup_status: text(row.cleanup_status, "cleanup_status"),
    prepared_at: optionalText(row.prepared_at), expires_at_estimated: optionalText(row.expires_at), created_at: text(row.created_at, "created_at"), updated_at: text(row.updated_at, "updated_at"),
  }));

  return {
    media_assets: assets.map((row) => ({ asset_id: text(row.asset_id, "asset_id"), checksum_sha256: optionalText(row.checksum_sha256), extension: text(row.extension, "extension"),
      file_size: Number(row.file_size), duration_ms: asNumber(row.duration_ms), width: asNumber(row.width), height: asNumber(row.height), availability_status: text(row.availability_status, "availability_status"),
      rights_status: text(row.rights_status, "rights_status"), source_relative_path: null, created_at: text(row.created_at, "created_at"), updated_at: text(row.updated_at, "updated_at") })),
    derived_reels: derivedReels, editorial_packages: editorialPackages, editorial_versions: editorialVersions, human_reviews: humanReviews,
    bible_evidence: bibleEvidence, bible_verifications: bibleVerifications, rights_sources: rightsSources, rights_confirmations: rightsConfirmations,
    content_ready_evaluations: contentReadyEvaluations, publication_records: publicationRecords, publication_audit: publicationAudit,
    analytics_snapshots: analyticsSnapshots, review_sessions: reviewSessions, temporary_media_records: temporaryMediaRecords,
  };
}

function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return JSON.stringify(new Date(timestamp).toISOString());
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Row).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Row)[key])}`).join(",")}}`;
}

function sameRow(expected: Row, actual: Row): boolean {
  return Object.keys(expected).every((key) => canonical(expected[key] ?? null) === canonical(actual[key] ?? null));
}

function rowKey(table: string, row: Row): string { return CONFLICT_KEYS[table].map((key) => String(row[key] ?? "")).join("\u001f"); }

type SupabaseClient = { url: string; serverSecret: string; legacyServiceRole: boolean };

function headers(client: SupabaseClient): Record<string, string> {
  const result: Record<string, string> = { apikey: client.serverSecret };
  if (client.legacyServiceRole) result.Authorization = `Bearer ${client.serverSecret}`;
  return result;
}

async function request(client: SupabaseClient, url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, headers: { ...headers(client), ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30000) });
}

async function remoteRows(client: SupabaseClient, table: string): Promise<Row[]> {
  const pageSize = 500;
  const rows: Row[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const response = await request(client, `${client.url}/rest/v1/${table}?select=*&limit=${pageSize}&offset=${offset}`);
    if (!response.ok) throw new Error(`SUPABASE_IMPORT_REMOTE_READ_FAILED:${table}:${response.status}`);
    const page = await response.json() as unknown;
    if (!Array.isArray(page)) throw new Error(`SUPABASE_IMPORT_REMOTE_READ_INVALID:${table}`);
    rows.push(...page as Row[]);
    if (page.length < pageSize) return rows;
    if (offset > 100000) throw new Error("SUPABASE_IMPORT_REMOTE_READ_TOO_LARGE");
  }
}

async function activeAdminProfileId(client: SupabaseClient): Promise<string> {
  const response = await request(client, `${client.url}/rest/v1/profiles?select=id&role=eq.ADMIN&is_active=eq.true&limit=1`);
  if (!response.ok) throw new Error(`SUPABASE_IMPORT_ADMIN_PROFILE_READ_FAILED:${response.status}`);
  const rows = await response.json() as unknown;
  if (!Array.isArray(rows) || rows.length === 0 || typeof rows[0]?.id !== "string") throw new Error("SUPABASE_IMPORT_ADMIN_PROFILE_NOT_FOUND");
  return rows[0].id;
}

async function upsertRows(client: SupabaseClient, table: string, rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0;
  const conflict = encodeURIComponent(CONFLICT_KEYS[table].join(","));
  let written = 0;
  for (let offset = 0; offset < rows.length; offset += 100) {
    const batch = rows.slice(offset, offset + 100);
    const response = await request(client, `${client.url}/rest/v1/${table}?on_conflict=${conflict}`, { method: "POST", headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(batch) });
    if (!response.ok) throw new Error(`SUPABASE_IMPORT_WRITE_FAILED:${table}:${response.status}`);
    written += batch.length;
  }
  return written;
}

async function reconcileAndWrite(client: SupabaseClient, desired: Record<string, Row[]>): Promise<Record<string, { source_rows: number; reused_rows: number; written_rows: number }>> {
  const report: Record<string, { source_rows: number; reused_rows: number; written_rows: number }> = {};
  for (const table of TARGET_TABLES) {
    const expected = desired[table] ?? [];
    const existing = await remoteRows(client, table);
    const existingByKey = new Map(existing.map((row) => [rowKey(table, row), row]));
    const expectedByKey = new Map(expected.map((row) => [rowKey(table, row), row]));
    if ([...existingByKey.keys()].some((key) => !expectedByKey.has(key))) throw new Error(`REMOTE_NOT_EMPTY_REVIEW_REQUIRED:${table}`);
    for (const [key, row] of existingByKey) if (!sameRow(expectedByKey.get(key) as Row, row)) throw new Error(`SUPABASE_IMPORT_REMOTE_CONFLICT:${table}`);
    const missing = expected.filter((row) => !existingByKey.has(rowKey(table, row)));
    const written = await upsertRows(client, table, missing);
    report[table] = { source_rows: expected.length, reused_rows: existing.length, written_rows: written };
  }
  return report;
}

export async function importSupabase(config: MediaConfig, options: ImportOptions): Promise<Record<string, unknown>> {
  const source = options.inputPath ? path.resolve(options.inputPath) : exportPath(config);
  if (!fs.existsSync(source)) exportSqliteGovernance(config);
  const payload = JSON.parse(fs.readFileSync(source, "utf8")) as ExportPayload;
  const counts = Object.fromEntries(Object.entries(payload.tables ?? {}).map(([table, rows]) => [table, rows.length]));
  if (!options.apply) return { mode: "dry-run", would_import: counts, remote_write_enabled: false, apply_performed: false, secrets_exported: false, media_bytes_exported: false, migration_authority: "controlled-server-import" };

  const env = loadProjectEnvironment(process.env, config.repoRoot);
  if (resolveAdminDataSource(env) !== "supabase-readonly") throw new Error("ADMIN_REMOTE_DATA_SOURCE_REQUIRED");
  const supabase = resolveSupabaseConfiguration(env);
  if (!supabase.serverSecret || !supabase.serverSecretType) throw new Error("SUPABASE_IMPORT_SERVER_SECRET_REQUIRED");
  const client: SupabaseClient = { url: supabase.url, serverSecret: supabase.serverSecret, legacyServiceRole: supabase.serverSecretType === "LEGACY_SERVICE_ROLE" };
  const remote = await collectRemoteSupabaseValidation(env);
  if (remote.status !== "CONNECTED_SCHEMA_PRESENT") throw new Error(`SUPABASE_IMPORT_REMOTE_NOT_READY:${String(remote.status)}`);
  const adminProfileId = await activeAdminProfileId(client);
  const desired = buildRows(payload, adminProfileId);
  const tableReport = await reconcileAndWrite(client, desired);
  const verified = await reconcileAndWrite(client, desired);
  return {
    mode: "apply", apply_performed: true, migration_authority: "controlled-server-import", application_remote_write_enabled: false,
    admin_profile_reused: true, table_report: tableReport,
    post_write_verification: Object.fromEntries(Object.entries(verified).map(([table, report]) => [table, report.written_rows === 0 ? "MATCHED" : "UNEXPECTED_WRITE"])),
    stable_ids_preserved: true, secrets_exported: false, media_bytes_exported: false,
  };
}

export async function runSupabaseImport(config: MediaConfig, args: string[]): Promise<void> {
  const result = await importSupabase(config, { apply: args.includes("--apply"), inputPath: args.find((arg) => arg.startsWith("--input="))?.slice("--input=".length) });
  console.log(JSON.stringify(result, null, 2));
}
