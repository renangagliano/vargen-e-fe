export type AvailabilityStatus =
  | "LOCAL_AVAILABLE"
  | "NOT_LOCALLY_AVAILABLE"
  | "ACCESS_ERROR";

export type RightsStatus = "RIGHTS_PENDING_CONFIRMATION" | "RIGHTS_CONFIRMED" | "RIGHTS_REJECTED" | "UNKNOWN" | "USER_OWNED" | "LICENSED" | "REVIEW_REQUIRED";

export type MatchStatus = "MATCHED" | "UNMATCHED" | "AMBIGUOUS" | "REVIEW_REQUIRED";

export type MatchConfidence = "EXACT" | "HIGH" | "MEDIUM" | "LOW";

export type MediaFileKind = "mp4" | "mov" | "m4v" | "webm";

export type MediaFile = {
  absolutePath: string;
  relativePath: string;
  sourceFilename: string;
  extension: MediaFileKind;
  size: number;
  mtimeMs: number;
};

export type MediaMetadata = {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  displayAspectRatio: string | null;
  sampleAspectRatio: string | null;
  frameRate: number | null;
  videoCodec: string | null;
  pixelFormat: string | null;
  audioCodec: string | null;
  audioChannels: number | null;
  audioSampleRate: number | null;
  bitrate: number | null;
  container: string | null;
};

export type SongCatalogEntry = {
  slug: string;
  title: string;
  category: string;
  videoId: string | null;
};

export type SongMatch = {
  song: SongCatalogEntry | null;
  status: MatchStatus;
  method: string | null;
  confidence: MatchConfidence | null;
  score: number | null;
};

export type ScanSummary = {
  directoriesVisited: number;
  supportedFilesFound: number;
  mp4Files: number;
  movFiles: number;
  m4vFiles: number;
  webmFiles: number;
  locallyAvailable: number;
  unavailable: number;
  accessErrors: number;
  indexedAssets: number;
  checksumFailures: number;
  ffprobeSuccesses: number;
  ffprobeFailures: number;
  duplicateChecksums: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  reviewRequired: number;
};

export type CandidateCategory =
  | "LYRICAL_HOOK"
  | "MAIN_CHORUS"
  | "PRE_CHORUS"
  | "SCRIPTURE_HOOK"
  | "EMOTIONAL_PEAK"
  | "VOCAL_ENTRY"
  | "INSTRUMENTAL_CLIMAX"
  | "GUITAR_SOLO"
  | "FINAL_REFRAIN"
  | "STORY_BUILD"
  | "REFLECTIVE_MOMENT";

export type CandidateStatus = "PROPOSED" | "SELECTED" | "REJECTED" | "GENERATED" | "VALIDATED" | "VALIDATION_FAILED";

export type CurationQualityTier = "TIER_A" | "TIER_B" | "TIER_C" | "TIER_D" | "TIER_REJECT";
export type PortfolioStatus = "ACTIVE" | "HOLD" | "REJECTED";
export type CurationDecision = "KEEP_PRIMARY" | "KEEP_SECONDARY" | "KEEP_EXCEPTIONAL_THIRD" | "HOLD" | "REJECT_REDUNDANT" | "REJECT_LOW_VALUE" | "REJECT_WEAK_BOUNDARY" | "REJECT_LOW_DISTINCTIVENESS";
export type BibleReferenceStatus = "VERIFIED" | "INFERRED_REVIEW_REQUIRED" | "MISSING" | "CONFLICT";
export type Seasonality = "EVERGREEN" | "LITURGICAL_SEASONAL" | "WEEKDAY_SPECIFIC" | "MONTH_SPECIFIC" | "DEVOTIONAL";

export type ReelCuration = {
  curation_id: string;
  reel_id: string;
  candidate_id: string;
  source_asset_id: string;
  curation_version: string;
  absolute_quality_score: number;
  relative_song_score: number;
  distinctiveness_score: number;
  editorial_value_score: number;
  technical_quality_score: number;
  boundary_quality_score: number;
  visual_quality_score: number;
  audio_quality_score: number;
  content_density_score: number;
  curation_score: number;
  incremental_editorial_value: number;
  overlap_percentage: number;
  timestamp_distance_ms: number;
  section_separation: number;
  within_song_rank: number;
  quality_tier: CurationQualityTier;
  portfolio_status: PortfolioStatus;
  curation_decision: CurationDecision;
  curation_reason: string;
  third_reel_justification: string | null;
  bible_reference_status: BibleReferenceStatus;
  seasonality: Seasonality;
  calendar_context: string | null;
  created_at: string;
  curated_at: string;
};

export type AudioEnergySample = {
  timeMs: number;
  rmsDb: number;
  normalizedEnergy: number;
};

export type MediaAnalysisReport = {
  sourceAssetId: string;
  durationMs: number;
  audioSampleCount: number;
  audioEnergyMinDb: number | null;
  audioEnergyMaxDb: number | null;
  silenceSampleCount: number;
  sceneChangeCount: number;
  lyricsSynchronized: false;
  samples: AudioEnergySample[];
};

export type ReelCandidate = {
  candidateId: string;
  sourceAssetId: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  category: CandidateCategory;
  score: number;
  selectionReason: string;
  status: CandidateStatus;
  fingerprint: string;
  confidence?: number;
  scoreBreakdown?: Record<string, number>;
  analysisVersion?: string;
  configurationVersion?: string;
  decision?: "SELECTED" | "REJECTED" | "NO_QUALIFIED_REEL";
};

export type DerivedReelMetadata = {
  reel_id: string;
  source_asset_id: string;
  source_filename: string | null;
  source_relative_path: string | null;
  song_title: string | null;
  collection: string | null;
  start_time_ms: number;
  end_time_ms: number;
  duration_ms: number | null;
  candidate_category: CandidateCategory;
  selection_reason: string;
  clip_score: number;
  candidate_confidence?: number | null;
  score_breakdown?: Record<string, number> | null;
  output_filename: string;
  output_path: string;
  resolution: string | null;
  fps: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  file_size: number | null;
  template_version: string;
  processing_version: string;
  rights_status: RightsStatus | null;
  generation_timestamp: string;
  validation_status: "PASS" | "FAIL";
  subtitle_status: "NOT_GENERATED_NO_RELIABLE_SYNC";
  source_checksum_before: string | null;
  source_checksum_after: string | null;
};

export type HookCategory = "QUESTION" | "SCRIPTURE" | "IDENTIFICATION" | "EMOTIONAL" | "OVERCOMING" | "REFLECTION" | "CURIOSITY";

export type HookCandidate = {
  category: HookCategory;
  text: string;
};

export type PublicationPriority = "HIGH" | "MEDIUM" | "LOW";

export type EditorialReviewStatus = "READY_FOR_HUMAN_REVIEW" | "APPROVED" | "REJECTED" | "NEEDS_CHANGES";

export type EditorialPackage = {
  reel_id: string;
  editorial_title: string;
  hook_candidates: HookCandidate[];
  selected_hook: string;
  caption: string;
  bible_reference: string;
  bible_reference_review_required?: boolean;
  cta: string;
  hashtags: string[];
  content_pillar: string;
  secondary_pillar: string | null;
  editorial_intent: string;
  cover_filename: string;
  cover_path: string;
  cover_text: string;
  editorial_version: number;
  review_status: EditorialReviewStatus;
  publication_status: "NOT_PUBLISHED";
  publication_priority: PublicationPriority;
  suggested_context: string;
  suggested_spacing: string;
  rights_status: RightsStatus;
  generated_at: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
};

export type BibleSourceType = "CATALOG_METADATA" | "SONG_METADATA" | "LYRICS_METADATA" | "SONG_LYRICS" | "SONG_CREATION_PROMPT" | "SUNO_PROMPT" | "PROJECT_DOCUMENTATION" | "LITURGICAL_METADATA" | "VIDEO_METADATA" | "HUMAN_ENTERED" | "HUMAN_PROVIDED_REFERENCE" | "GENERATED_EDITORIAL" | "OTHER_LOCAL_SOURCE" | "OTHER_VERIFIED_LOCAL_SOURCE";
export type BibleVerificationStatus = "VERIFIED" | "REVIEW_REQUIRED" | "MISSING" | "CONFLICT";
export type ContentReadinessStatus = "CONTENT_READY" | "NOT_READY";

export type AiRecommendation = "RECOMMEND_APPROVE" | "RECOMMEND_CHANGES" | "RECOMMEND_REJECT" | "HUMAN_REVIEW_REQUIRED";
export type AiDuplicateRisk = "LOW" | "MEDIUM" | "HIGH";
export type AiRiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type AiBibleConfidence = "HIGH" | "MEDIUM" | "LOW";
export type AiBibleSuggestionStatus = "AI_SUGGESTED" | "HUMAN_VERIFIED" | "REJECTED" | "CONFLICT" | "INSUFFICIENT_EVIDENCE";
export type AiEditorialSuggestionStatus = "PROPOSED" | "APPLIED" | "DISMISSED";

export type KnowledgeBibleClassification = "HUMAN_VERIFIED" | "KNOWLEDGE_CORROBORATED_HIGH" | "KNOWLEDGE_INFERRED_MEDIUM" | "KNOWLEDGE_REVIEW_REQUIRED" | "INSUFFICIENT_EVIDENCE" | "CONFLICT";
export type KnowledgeEditorialSuggestionStatus = "PROPOSED" | "APPLIED" | "DISMISSED";
export type Section8GenericLanguage = "GENERIC_LOW" | "GENERIC_MEDIUM" | "GENERIC_HIGH";
export type Section8ReviewQueue = "FAST_PATH" | "STANDARD_REVIEW" | "EDITORIAL_CHANGES_REQUIRED" | "BIBLE_VERIFICATION_REQUIRED" | "CONFLICT_REVIEW";

export type KnowledgeBibleResolution = {
  resolution_id: string;
  reel_id: string;
  song_slug: string;
  resolver_version: string;
  suggested_reference: string | null;
  book: string | null;
  chapter: number | null;
  verse_start: number | null;
  verse_end: number | null;
  classification: KnowledgeBibleClassification;
  confidence_level: AiBibleConfidence;
  confidence_score: number;
  evidence_level: string;
  knowledge_confidence: string;
  verification_status: string;
  biblical_story: string;
  core_message: string;
  provenance: Record<string, unknown>;
  evidence_sources: string[];
  legacy_reference: string | null;
  human_verified_reference: string | null;
  conflict_reason: string | null;
  reasoning_summary: string;
};

export type KnowledgeEditorialSuggestion = {
  suggestion_id: string;
  reel_id: string;
  song_slug: string;
  suggestion_version: string;
  base_editorial_version: number;
  suggested_package: Partial<EditorialPackage>;
  changed_fields: string[];
  source_context: Record<string, unknown>;
  reasoning_summary: string;
  status: KnowledgeEditorialSuggestionStatus;
};

export type Section8EditorialCalibration = {
  reel_id: string;
  song_slug: string;
  calibration_version: string;
  old_overall_score: number | null;
  old_editorial_quality_score: number | null;
  structural_compliance: number;
  specificity_score: number;
  biblical_alignment_score: number;
  song_context_alignment_score: number;
  distinctiveness_score: number;
  brand_voice_score: number;
  narrative_value_score: number;
  cta_quality_score: number;
  retention_potential_score: number;
  duplication_penalty: number;
  editorial_quality_score: number;
  generic_language_level: Section8GenericLanguage;
  generic_phrases: string[];
  duplicate_risk: AiDuplicateRisk;
  related_reel_ids: string[];
  bible_classification: KnowledgeBibleClassification;
  review_queue: Section8ReviewQueue;
  review_priority_score: number;
  review_priority_rank: number | null;
  reasoning_summary: string;
  knowledge_context_hash: string;
};

export type KnowledgeEditorialContext = {
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
  evidence_level: string;
  confidence: string;
  verification_status: string;
  provenance: Record<string, unknown>;
};

export type BiblicalResolutionType = "SUGGESTED_EXPLICIT" | "SUGGESTED_CORROBORATED" | "SUGGESTED_NARRATIVE" | "HUMAN_VERIFIED" | "INSUFFICIENT" | "CONFLICT";
export type BiblicalResolutionConfidence = "HIGH" | "MEDIUM" | "LOW";
export type BiblicalResolutionStatus = "AI_SUGGESTED" | "HUMAN_VERIFIED" | "REJECTED" | "CONFLICT" | "INSUFFICIENT_EVIDENCE";

export type SourceRegistryRecord = {
  source_record_id: string;
  song_slug: string;
  source_type: BibleSourceType;
  source_location: string;
  content_hash: string;
  source_title: string | null;
  source_version: string | null;
  is_authoritative: boolean;
  discovered_at: string;
  metadata_json_safe: Record<string, unknown>;
};

export type EditorialCalibration = {
  reel_id: string;
  song_slug: string;
  calibration_version: string;
  structural_scores: Record<string, number>;
  quality_scores: Record<string, number>;
  generic_language_level: "GENERIC_LOW" | "GENERIC_MEDIUM" | "GENERIC_HIGH";
  generic_phrases: string[];
  cross_catalog_similarity: Record<string, unknown>;
  editorial_quality_score: number;
  distinctiveness_score: number;
  retention_score: number;
  overall_score: number;
  duplicate_risk: AiDuplicateRisk;
  related_reel_ids: string[];
  biblical_evidence_status: string;
  recommendation: AiRecommendation;
  fast_path_status: "FAST_PATH" | "NOT_ELIGIBLE";
  evidence_needed_status: "EVIDENCE_NEEDED" | "NOT_NEEDED";
  review_priority_score: number;
  review_priority_rank: number | null;
  suggested_package: Partial<EditorialPackage>;
  reasoning_summary: string;
  engine_version: string;
};

export type BiblicalResolutionEvidence = {
  resolution_id: string;
  song_slug: string;
  reel_id: string;
  suggested_reference: string | null;
  resolution_type: BiblicalResolutionType;
  confidence: BiblicalResolutionConfidence;
  evidence_source_record_ids: string[];
  evidence_excerpt_safe: string;
  reasoning_summary: string;
  status: BiblicalResolutionStatus;
  sources: Array<{ source_record_id: string; source_type: string; source_location: string; is_authoritative: boolean; source_title: string | null }>;
};

export type AiReviewResult = {
  reel_id: string;
  ai_review_version: string;
  provider: string;
  ai_reviewed_at: string;
  editorial_quality_score: number;
  hook_score: number;
  caption_score: number;
  cta_score: number;
  hashtag_score: number;
  title_score: number;
  pillar_consistency_score: number;
  collection_consistency_score: number;
  biblical_consistency_score: number;
  theological_risk: number;
  duplicate_risk: AiDuplicateRisk;
  retention_score: number;
  clarity_score: number;
  emotional_impact_score: number;
  authenticity_score: number;
  clickbait_risk: number;
  overall_ai_score: number;
  ai_recommendation: AiRecommendation;
  ai_reasoning_summary: string;
  related_reel_ids: string[];
  review_priority_score: number | null;
  review_priority_rank: number | null;
  engine_version: string;
};

export type AiBibleSuggestion = {
  suggestion_id: string;
  reel_id: string;
  ai_review_version: string;
  reference: string | null;
  book: string | null;
  chapter: number | null;
  verse_range: string | null;
  confidence: AiBibleConfidence;
  evidence_sources: string[];
  reasoning_summary: string;
  status: AiBibleSuggestionStatus;
  engine_version: string;
};

export type AiEditorialSuggestion = {
  suggestion_id: string;
  reel_id: string;
  ai_review_version: string;
  base_editorial_version: number;
  suggested_package: Partial<EditorialPackage>;
  changed_fields: string[];
  reasoning_summary: string;
  status: AiEditorialSuggestionStatus;
  engine_version: string;
};

export type BibleReferenceSource = {
  bible_reference_id: string;
  reel_id: string;
  editorial_version: number | null;
  reference: string;
  source_type: BibleSourceType;
  source_location: string;
  verification_status: BibleVerificationStatus;
  verified_by: string | null;
  verified_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicationMode = "dry-run" | "approval" | "full-auto";
export type PublicationStatus = "NOT_PUBLISHED" | "NOT_ELIGIBLE" | "READY_FOR_PUBLISHING" | "SCHEDULED" | "QUEUED" | "PUBLISHING" | "PROCESSING_REMOTE" | "PUBLISHED" | "PUBLISH_FAILED" | "BLOCKED_EXTERNAL" | "CANCELLED" | "DRY_RUN_VALIDATED" | "DRY_RUN_BLOCKED";
export type FailureClass = "TRANSIENT" | "PERMANENT" | "AUTHENTICATION" | "RATE_LIMIT" | "VALIDATION" | "EXTERNAL_BLOCKER";

export type EligibilityResult = {
  status: "READY_FOR_PUBLISHING" | "BLOCKED";
  gates: Record<string, "PASS" | "FAIL" | "BLOCKED">;
  reasons: string[];
};

export type PublicationPayload = {
  publication_key: string;
  reel_id: string;
  editorial_version: number;
  caption: string;
  video_url: string;
  cover_path: string;
  target_account: string;
};

export type PublicationJob = {
  publication_job_id: string;
  publication_key: string;
  reel_id: string;
  editorial_version: number;
  publisher: string;
  mode: PublicationMode;
  scheduled_at: string;
  timezone: string;
  status: PublicationStatus;
  attempt_count: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
  last_attempt_at: string | null;
  published_at: string | null;
  remote_container_id: string | null;
  remote_media_id: string | null;
  error_code: string | null;
  error_message_safe: string | null;
  failure_class: FailureClass | null;
};

export const EMPTY_METADATA: MediaMetadata = {
  durationMs: null,
  width: null,
  height: null,
  displayAspectRatio: null,
  sampleAspectRatio: null,
  frameRate: null,
  videoCodec: null,
  pixelFormat: null,
  audioCodec: null,
  audioChannels: null,
  audioSampleRate: null,
  bitrate: null,
  container: null,
};
