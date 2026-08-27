import type { MediaConfig } from "../config/index.js";
import { openDatabase } from "../database/db.js";

export const REMOTE_TABLE_MAPPING = {
  derived_reels: "review_reels",
  reel_editorial_packages: "editorial_versions",
  bible_reference_sources: "bible_reference_sources",
  source_rights_history: "rights_evidence",
  review_sessions: "review_sessions",
  content_readiness: "content_readiness_snapshots",
  pilot_snapshots: "publication_records.snapshot_metadata",
  pilot_publications: "publication_records",
  publication_audit_events: "publication_audit_events",
  instagram_analytics_snapshots: "analytics_snapshots",
  temporary_media: "temporary_media_metadata",
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

export async function runRemoteMigrationValidation(config: MediaConfig): Promise<void> {
  console.log(JSON.stringify({ plan: remoteMigrationPlan(), validation: collectRemoteMigrationValidation(config) }, null, 2));
}
