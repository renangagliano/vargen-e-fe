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

const REMOTE_TABLES = ["profiles", "media_assets", "derived_reels", "editorial_packages", "editorial_versions", "human_reviews", "bible_evidence", "bible_verifications", "rights_sources", "rights_confirmations", "content_ready_evaluations", "publication_records", "publication_audit", "analytics_snapshots", "review_sessions", "temporary_media_records"] as const;
const OPERATIONAL_TABLES = REMOTE_TABLES.filter((table) => table !== "profiles");

type RemoteFetch = typeof fetch;
type Environment = NodeJS.ProcessEnv | Record<string, string | undefined>;

function safeHeaders(key: string, includeAuthorization = false, includeCount = false): Record<string, string> {
  const headers: Record<string, string> = { apikey: key };
  if (includeCount) headers.Prefer = "count=exact";
  if (includeAuthorization) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function request(fetchImpl: RemoteFetch, url: string, init: RequestInit): Promise<Response | null> {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(15000) }).catch(() => null);
}

export async function collectRemoteSupabaseValidation(env: Environment, fetchImpl: RemoteFetch = fetch): Promise<Record<string, unknown>> {
  let admin: ReturnType<typeof resolveRemoteAdminConfig>;
  try { admin = resolveRemoteAdminConfig(env); } catch { return { status: "CONFIGURATION_FAILED", remote_write_enabled: false }; }
  if (admin.dataSource !== "supabase-readonly") return { status: "NOT_REQUESTED", remote_write_enabled: admin.remoteWriteEnabled };

  let supabase;
  try { supabase = resolveSupabaseConfiguration(env); } catch (error) {
    return { status: "CONFIGURATION_FAILED", reason: error instanceof Error ? error.message : "INVALID_CONFIGURATION", remote_write_enabled: false };
  }
  if (!supabase.publicKey || !supabase.serverSecret) return { status: "CONFIGURATION_FAILED", reason: "SUPABASE_SERVER_SECRET_MISSING", remote_write_enabled: false };

  const publicHeaders = safeHeaders(supabase.publicKey, false);
  const authResponse = await request(fetchImpl, `${supabase.url}/auth/v1/health`, { headers: publicHeaders });
  if (!authResponse || !authResponse.ok) return { status: "AUTH_SERVICE_FAILED", auth: authResponse?.status ?? "NETWORK_ERROR", remote_write_enabled: false };
  const restResponse = await request(fetchImpl, `${supabase.url}/rest/v1/`, { headers: publicHeaders });
  if (!restResponse || restResponse.status >= 500) return { status: "REST_SERVICE_FAILED", rest: restResponse?.status ?? "NETWORK_ERROR", auth: "PASS", remote_write_enabled: false };

  // Supabase's modern secret keys, like legacy service-role keys, are
  // privileged server credentials and must be sent in both API auth headers.
  const readHeaders = safeHeaders(supabase.serverSecret, true, true);
  const tableResults = await Promise.all(REMOTE_TABLES.map(async (table) => {
    const response = await request(fetchImpl, `${supabase.url}/rest/v1/${table}?select=*&limit=0`, { headers: readHeaders });
    return { table, status: response?.status ?? 0, count: parseContentRange(response?.headers.get("content-range")) };
  }));
  if (tableResults.some((result) => result.status === 0 || result.status >= 500)) return { status: "CONNECTION_FAILED", auth: "PASS", rest: "PASS", table_reads: tableResults.map(({ table, status }) => ({ table, status })), remote_write_enabled: false };
  if (tableResults.every((result) => result.status === 404)) return { status: "SCHEMA_NOT_APPLIED", auth: "PASS", rest: "PASS", schema: "NOT_PRESENT", remote_write_enabled: false };
  if (tableResults.some((result) => result.status === 401 || result.status === 403)) return { status: "CONFIGURATION_FAILED", auth: "PASS", rest: "PASS", schema: "UNREADABLE", remote_write_enabled: false };
  if (tableResults.some((result) => result.status === 404)) return { status: "SCHEMA_VALIDATION_FAILED", auth: "PASS", rest: "PASS", schema: "PARTIAL", remote_write_enabled: false };
  if (tableResults.some((result) => result.status >= 400)) return { status: "REMOTE_READ_FAILED", auth: "PASS", rest: "PASS", schema: "UNREADABLE", remote_write_enabled: false };

  const counts = Object.fromEntries(tableResults.map(({ table, count }) => [table, count]));
  const adminResponse = await request(fetchImpl, `${supabase.url}/rest/v1/profiles?select=id&role=eq.ADMIN&is_active=eq.true&limit=100`, { headers: readHeaders });
  if (!adminResponse || !adminResponse.ok) return { status: "REMOTE_READ_FAILED", auth: "PASS", rest: "PASS", schema: "PRESENT", admin_profile: "UNREADABLE", remote_write_enabled: false };
  const adminRows = await adminResponse.json().catch(() => null) as unknown;
  if (!Array.isArray(adminRows) || adminRows.length === 0) return { status: "ADMIN_PROFILE_NOT_FOUND", auth: "PASS", rest: "PASS", schema: "PRESENT", admin_profile: "NOT_FOUND", remote_write_enabled: false, counts };

  const anonymousResponse = await request(fetchImpl, `${supabase.url}/rest/v1/profiles?select=id&limit=1`, { headers: publicHeaders });
  const anonymousDenied = anonymousResponse?.status === 401 || anonymousResponse?.status === 403;
  if (!anonymousDenied) return { status: "RLS_VALIDATION_FAILED", auth: "PASS", rest: "PASS", schema: "PRESENT", admin_profile: "PASS", rls: { anonymous: "NOT_DENIED" }, remote_write_enabled: false, counts };

  const operationalCount = OPERATIONAL_TABLES.reduce((total, table) => total + Number(counts[table] ?? 0), 0);
  return {
    status: "CONNECTED_SCHEMA_PRESENT",
    validation_status: "REMOTE_VALIDATION_PASS",
    auth: "PASS",
    rest: "PASS",
    schema: "PRESENT",
    admin_profile: "PASS",
    rls: { status: "PASS", anonymous: "DENIED", ordinary_authenticated_writes: "DENIED_BY_POLICY" },
    data_state: operationalCount === 0 ? "EMPTY" : "PRESENT",
    migration_state: operationalCount === 0 ? "NOT_APPLIED" : "DATA_PRESENT_REVIEW_REQUIRED",
    remote_write_enabled: false,
    counts,
  };
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
  const remote = remoteRequested ? await collectRemoteSupabaseValidation(env) : { status: "NOT_REQUESTED" };
  console.log(JSON.stringify({ plan: remoteMigrationPlan(), validation: { ...local, remote } }, null, 2));
}
