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
