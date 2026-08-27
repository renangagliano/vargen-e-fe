import type { MediaConfig } from "../config/index.js";
import { openDatabase } from "../database/db.js";
import { loadProjectEnvironment } from "../config/index.js";
import { resolveRemoteAdminConfig } from "../config/remote-admin.js";
import { resolveSupabaseConfiguration } from "../config/supabase.js";

export const REMOTE_TABLE_MAPPING = {
  media_assets: "media_assets",
  derived_reels: "derived_reels",
  reel_editorial_packages: "editorial_versions",
  bible_reference_sources: "bible_evidence",
  source_rights_history: "rights_sources + rights_confirmations",
  review_sessions: "review_sessions",
  content_readiness: "content_ready_evaluations",
  pilot_snapshots: "publication_records.snapshot_id",
  pilot_publications: "publication_records",
  publication_audit_events: "publication_audit",
  instagram_analytics_snapshots: "analytics_snapshots",
  temporary_media: "temporary_media_records",
} as const;

const TABLES = ["media_assets", "media_locations", "derived_reels", "reel_editorial_packages", "bible_reference_sources", "source_rights_history", "review_sessions", "content_readiness", "pilot_snapshots", "pilot_publications", "publication_audit_events", "instagram_analytics_snapshots", "temporary_media"] as const;

export function remoteMigrationPlan(): Array<{ source: string; target: string }> {
  return Object.entries(REMOTE_TABLE_MAPPING).map(([source, target]) => ({ source, target }));
}

export function collectRemoteMigrationValidation(config: MediaConfig): Record<string, unknown> {
  const db = openDatabase(config);
  try {
    const counts = Object.fromEntries(TABLES.map((table) => [table, Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count)]));
    const integrity = db.prepare("SELECT COUNT(*) AS count FROM derived_reels WHERE source_checksum_before IS NOT NULL AND source_checksum_before = source_checksum_after").get() as { count: number };
    const contentReady = db.prepare("SELECT COUNT(*) AS count FROM content_readiness WHERE status = 'CONTENT_READY'").get() as { count: number };
    return { generated_at: new Date().toISOString(), authority: "local-sqlite", counts, invariants: { derived_reels_with_matching_source_checksums: Number(integrity.count), content_ready_rows: Number(contentReady.count), secrets_exported: false, media_bytes_exported: false } };
  } finally { db.close(); }
}

const REMOTE_TABLES = ["media_assets", "derived_reels", "editorial_versions", "publication_records", "analytics_snapshots"] as const;

async function remoteCounts(config: MediaConfig): Promise<Record<string, unknown>> {
  const env = loadProjectEnvironment(process.env, config.repoRoot);
  const admin = resolveRemoteAdminConfig(env);
  if (admin.dataSource !== "supabase-readonly") return { status: "NOT_REQUESTED" };
  const supabase = resolveSupabaseConfiguration(env);
  if (!supabase.publicKey) return { status: "AUTH_CONFIGURATION_FAILED", reason: "SUPABASE_PUBLIC_KEY_MISSING" };
  const publicHeaders = { apikey: supabase.publicKey };
  const authResponse = await fetch(`${supabase.url}/auth/v1/health`, { headers: publicHeaders, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!authResponse || !authResponse.ok) return { status: "CONNECTION_FAILED", auth: authResponse?.status ?? "NETWORK_ERROR" };
  const restResponse = await fetch(`${supabase.url}/rest/v1/`, { headers: publicHeaders, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!restResponse || (restResponse.status < 200 || restResponse.status >= 500)) return { status: "CONNECTION_FAILED", rest: restResponse?.status ?? "NETWORK_ERROR" };

  const readKey = supabase.serverSecret ?? supabase.publicKey;
  const readHeaders: Record<string, string> = { apikey: readKey, Prefer: "count=exact" };
  if (supabase.serverSecretType === "LEGACY_SERVICE_ROLE") readHeaders.Authorization = `Bearer ${readKey}`;
  const results = await Promise.all(REMOTE_TABLES.map(async (table) => {
    const response = await fetch(`${supabase.url}/rest/v1/${table}?select=*&limit=0`, { headers: readHeaders, signal: AbortSignal.timeout(15000) }).catch(() => null);
    return { table, status: response?.status ?? 0, count: parseContentRange(response?.headers.get("content-range")) };
  }));
  if (results.some((result) => result.status >= 500 || result.status === 0)) return { status: "CONNECTION_FAILED", table_reads: results.map(({ table, status }) => ({ table, status })) };
  if (results.every((result) => result.status === 404)) return { status: "CONNECTED_SCHEMA_NOT_APPLIED", auth: "PASS", rest: "PASS" };
  if (results.some((result) => result.status === 401 || result.status === 403)) return { status: "AUTH_CONFIGURATION_FAILED", auth: "PASS", rest: "PASS" };
  if (results.some((result) => result.status >= 400)) return { status: "REMOTE_READ_FAILED", auth: "PASS", rest: "PASS" };
  return { status: "CONNECTED_SCHEMA_PRESENT", auth: "PASS", rest: "PASS", counts: Object.fromEntries(results.map(({ table, count }) => [table, count])) };
}

function parseContentRange(value: string | null | undefined): number {
  if (!value) return 0;
  const total = value.split("/")[1];
  const count = Number(total);
  return Number.isFinite(count) ? count : 0;
}

export async function runRemoteMigrationValidation(config: MediaConfig, args: string[] = []): Promise<void> {
  const local = collectRemoteMigrationValidation(config);
  const env = loadProjectEnvironment(process.env, config.repoRoot);
  const remoteRequested = args.includes("--remote") || env.ADMIN_DATA_SOURCE?.trim() === "supabase-readonly";
  const remote = remoteRequested ? await remoteCounts(config) : { status: "NOT_REQUESTED" };
  console.log(JSON.stringify({ plan: remoteMigrationPlan(), validation: { ...local, remote } }, null, 2));
}
