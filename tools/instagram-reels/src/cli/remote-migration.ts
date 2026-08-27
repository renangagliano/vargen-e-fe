import type { MediaConfig } from "../config/index.js";
import { openDatabase } from "../database/db.js";
import { loadProjectEnvironment } from "../config/index.js";
import { createClient } from "@supabase/supabase-js";

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

async function remoteCounts(config: MediaConfig): Promise<Record<string, number> | { status: string }> {
  const env = loadProjectEnvironment(process.env, config.repoRoot);
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return { status: "NOT_CONFIGURED" };
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  const tables = ["media_assets", "derived_reels", "editorial_versions", "publication_records", "analytics_snapshots"] as const;
  const entries = await Promise.all(tables.map(async (table) => {
    const result = await client.from(table).select("*", { count: "exact", head: true });
    if (result.error) throw new Error("REMOTE_VALIDATION_READ_FAILED");
    return [table, result.count ?? 0] as const;
  }));
  return Object.fromEntries(entries);
}

export async function runRemoteMigrationValidation(config: MediaConfig, args: string[] = []): Promise<void> {
  const local = collectRemoteMigrationValidation(config);
  const remote = args.includes("--remote") ? await remoteCounts(config) : { status: "NOT_REQUESTED" };
  console.log(JSON.stringify({ plan: remoteMigrationPlan(), validation: { ...local, remote } }, null, 2));
}
