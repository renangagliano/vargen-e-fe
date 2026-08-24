export type AvailabilityStatus =
  | "LOCAL_AVAILABLE"
  | "NOT_LOCALLY_AVAILABLE"
  | "ACCESS_ERROR";

export type RightsStatus = "RIGHTS_PENDING_CONFIRMATION" | "UNKNOWN" | "USER_OWNED" | "LICENSED" | "REVIEW_REQUIRED";

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
