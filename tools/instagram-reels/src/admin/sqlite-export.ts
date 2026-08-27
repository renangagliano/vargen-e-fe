import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { databasePath, type MediaConfig } from "../config/index.js";
import { openDatabase } from "../database/db.js";

const EXPORT_TABLES = ["media_assets", "derived_reels", "reel_editorial_packages", "bible_reference_sources", "source_rights_history", "review_sessions", "content_readiness", "pilot_snapshots", "pilot_publications", "publication_audit_events", "instagram_analytics_snapshots", "temporary_media"] as const;
const SENSITIVE_KEY = /(token|secret|password|authorization|cookie|download.?url|access.?key)/i;

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !SENSITIVE_KEY.test(key)).map(([key, nested]) => [key, sanitize(nested)]));
  if (typeof value === "string" && /^(https?:\/\/)/i.test(value) && /[?&](sig|token|sv|se|sp)=/i.test(value)) return "[REDACTED_URL]";
  return value;
}

function rowsForTable(db: ReturnType<typeof openDatabase>, table: string): unknown[] {
  return db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all().map((row) => sanitize(row));
}

export function exportPath(config: MediaConfig): string { return path.join(config.pipelineStateRoot, "remote-migration", "sqlite-export.json"); }

export function exportSqliteGovernance(config: MediaConfig): { path: string; manifest: Record<string, unknown> } {
  const db = openDatabase(config);
  try {
    const tables = Object.fromEntries(EXPORT_TABLES.map((table) => [table, rowsForTable(db, table)]));
    const payload = { schema_version: "sqlite-migration-v1", authority: "local-sqlite", generated_at: new Date().toISOString(), source_database: databasePath(config), tables };
    const serialized = JSON.stringify(payload, null, 2);
    const idKeys = ["asset_id", "reel_id", "editorial_version", "bible_reference_id", "confirmation_id", "session_id", "snapshot_id", "publication_key", "event_id", "analytics_snapshot_id", "temporary_media_id"];
    const stableIds = Object.fromEntries(EXPORT_TABLES.map((table) => [table, tables[table].map((value) => { const record = value as Record<string, unknown>; const key = idKeys.find((candidate) => candidate in record); return key ? record[key] : null; }).filter((value): value is string | number => typeof value === "string" || typeof value === "number")]));
    const manifest = { schema_version: payload.schema_version, generated_at: payload.generated_at, source_sha256: createHash("sha256").update(serialized).digest("hex"), table_counts: Object.fromEntries(EXPORT_TABLES.map((table) => [table, tables[table].length])), stable_ids: stableIds, secrets_exported: false, media_bytes_exported: false };
    const destination = exportPath(config);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `${JSON.stringify({ ...payload, manifest }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return { path: destination, manifest };
  } finally { db.close(); }
}

export function runSqliteExport(config: MediaConfig): void {
  const result = exportSqliteGovernance(config);
  const { stable_ids: _stableIds, ...safeManifest } = result.manifest;
  console.log(JSON.stringify({ export_path: "[RUNTIME_STATE]", manifest: safeManifest }, null, 2));
}
