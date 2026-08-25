import type { KnowledgeBaseCatalog, KnowledgeBaseSong } from "./types";

const EVIDENCE_LEVELS = new Set(["EXPLICIT", "CORROBORATED", "INFERRED", "UNKNOWN"]);
const CONFIDENCE_LEVELS = new Set(["HIGH", "MEDIUM", "LOW"]);
const VERIFICATION_STATUSES = new Set(["VERIFIED", "READY_FOR_EDITORIAL_REVIEW", "REVIEW_REQUIRED", "CONFLICT"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, location: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`KNOWLEDGE_BASE_INVALID_${location}_${key}`);
  return value;
}

function stringArray(record: Record<string, unknown>, key: string, location: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`KNOWLEDGE_BASE_INVALID_${location}_${key}`);
  return value;
}

function validateSong(value: unknown, index: number): KnowledgeBaseSong {
  const location = `SONG_${index + 1}`;
  if (!isRecord(value)) throw new Error(`KNOWLEDGE_BASE_INVALID_${location}`);

  const song: KnowledgeBaseSong = {
    song_id: requiredString(value, "song_id", location),
    slug: requiredString(value, "slug", location),
    title: requiredString(value, "title", location),
    collection: requiredString(value, "collection", location),
    liturgical_season: requiredString(value, "liturgical_season", location),
    liturgical_year: requiredString(value, "liturgical_year", location),
    core_message: requiredString(value, "core_message", location),
    summary: requiredString(value, "summary", location),
    primary_theme: requiredString(value, "primary_theme", location),
    secondary_themes: stringArray(value, "secondary_themes", location),
    primary_bible_reference: requiredString(value, "primary_bible_reference", location),
    secondary_bible_references: stringArray(value, "secondary_bible_references", location),
    biblical_story: requiredString(value, "biblical_story", location),
    biblical_characters: stringArray(value, "biblical_characters", location),
    liturgical_context: requiredString(value, "liturgical_context", location),
    calendar_context: requiredString(value, "calendar_context", location),
    editorial_keywords: stringArray(value, "editorial_keywords", location),
    historical_context: requiredString(value, "historical_context", location),
    evidence_level: requiredString(value, "evidence_level", location) as KnowledgeBaseSong["evidence_level"],
    confidence: requiredString(value, "confidence", location) as KnowledgeBaseSong["confidence"],
    verification_status: requiredString(value, "verification_status", location) as KnowledgeBaseSong["verification_status"],
    provenance: {
      catalog_source: "",
      curation_source: "",
      reference_method: "",
    },
  };

  if (!EVIDENCE_LEVELS.has(song.evidence_level)) throw new Error(`KNOWLEDGE_BASE_INVALID_${location}_evidence_level`);
  if (!CONFIDENCE_LEVELS.has(song.confidence)) throw new Error(`KNOWLEDGE_BASE_INVALID_${location}_confidence`);
  if (!VERIFICATION_STATUSES.has(song.verification_status)) throw new Error(`KNOWLEDGE_BASE_INVALID_${location}_verification_status`);
  if (!isRecord(value.provenance)) throw new Error(`KNOWLEDGE_BASE_INVALID_${location}_provenance`);

  song.provenance = {
    catalog_source: requiredString(value.provenance, "catalog_source", `${location}_PROVENANCE`),
    curation_source: requiredString(value.provenance, "curation_source", `${location}_PROVENANCE`),
    reference_method: requiredString(value.provenance, "reference_method", `${location}_PROVENANCE`),
    ...(typeof value.provenance.source_asset_video_id === "string" || value.provenance.source_asset_video_id === null ? { source_asset_video_id: value.provenance.source_asset_video_id } : {}),
  };
  return song;
}

export function validateKnowledgeBaseCatalog(value: unknown): KnowledgeBaseCatalog {
  if (!isRecord(value)) throw new Error("KNOWLEDGE_BASE_INVALID_ROOT");
  const songsValue = value.songs;
  if (!Array.isArray(songsValue)) throw new Error("KNOWLEDGE_BASE_INVALID_SONGS");

  const catalog: KnowledgeBaseCatalog = {
    schema_version: requiredString(value, "schema_version", "ROOT"),
    generated_at: requiredString(value, "generated_at", "ROOT"),
    purpose: requiredString(value, "purpose", "ROOT"),
    policy: {
      no_empty_catalog_records: false,
      inference_allowed: false,
      uncertain_items_flagged: false,
    },
    record_count: typeof value.record_count === "number" ? value.record_count : Number.NaN,
    songs: songsValue.map(validateSong),
  };

  if (!Number.isInteger(catalog.record_count) || catalog.record_count !== catalog.songs.length) throw new Error("KNOWLEDGE_BASE_RECORD_COUNT_MISMATCH");
  if (!isRecord(value.policy)) throw new Error("KNOWLEDGE_BASE_INVALID_POLICY");
  for (const key of ["no_empty_catalog_records", "inference_allowed", "uncertain_items_flagged"] as const) {
    if (typeof value.policy[key] !== "boolean") throw new Error(`KNOWLEDGE_BASE_INVALID_POLICY_${key}`);
    catalog.policy[key] = value.policy[key];
  }

  const songIds = new Set<string>();
  const slugs = new Set<string>();
  for (const song of catalog.songs) {
    if (songIds.has(song.song_id)) throw new Error(`KNOWLEDGE_BASE_DUPLICATE_SONG_ID_${song.song_id}`);
    if (slugs.has(song.slug)) throw new Error(`KNOWLEDGE_BASE_DUPLICATE_SLUG_${song.slug}`);
    songIds.add(song.song_id);
    slugs.add(song.slug);
  }
  return catalog;
}
