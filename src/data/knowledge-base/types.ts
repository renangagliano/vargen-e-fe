export type KnowledgeEvidenceLevel = "EXPLICIT" | "CORROBORATED" | "INFERRED" | "UNKNOWN";
export type KnowledgeConfidence = "HIGH" | "MEDIUM" | "LOW";
export type KnowledgeVerificationStatus = "VERIFIED" | "READY_FOR_EDITORIAL_REVIEW" | "REVIEW_REQUIRED" | "CONFLICT";

export type KnowledgeBaseProvenance = {
  catalog_source: string;
  curation_source: string;
  reference_method: string;
  source_asset_video_id?: string | null;
};

export type KnowledgeBasePolicy = {
  no_empty_catalog_records: boolean;
  inference_allowed: boolean;
  uncertain_items_flagged: boolean;
};

export type KnowledgeBaseSong = {
  song_id: string;
  slug: string;
  title: string;
  collection: string;
  liturgical_season: string;
  liturgical_year: string;
  core_message: string;
  summary: string;
  primary_theme: string;
  secondary_themes: string[];
  primary_bible_reference: string;
  secondary_bible_references: string[];
  biblical_story: string;
  biblical_characters: string[];
  liturgical_context: string;
  calendar_context: string;
  editorial_keywords: string[];
  historical_context: string;
  evidence_level: KnowledgeEvidenceLevel;
  confidence: KnowledgeConfidence;
  verification_status: KnowledgeVerificationStatus;
  provenance: KnowledgeBaseProvenance;
};

export type KnowledgeBaseCatalog = {
  schema_version: string;
  generated_at: string;
  purpose: string;
  policy: KnowledgeBasePolicy;
  record_count: number;
  songs: KnowledgeBaseSong[];
};

export type KnowledgeBaseIntegrityReport = {
  recordCount: number;
  expectedRecordCount: number;
  catalogSongCount: number;
  matchedSlugs: number;
  knowledgeBaseSlugsWithoutSong: string[];
  songsWithoutKnowledgeBase: string[];
  duplicateSongIds: string[];
  duplicateSlugs: string[];
  isValid: boolean;
};
