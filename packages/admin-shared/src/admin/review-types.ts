export type ReviewQueueKey = "PENDING" | "FAST_PATH" | "STANDARD_REVIEW" | "NEEDS_CHANGES" | "APPROVED" | "CONTENT_READY" | "PUBLISHED";
export type AdminRole = "ADMIN" | "REVIEWER" | "VIEWER";
export type ReviewStatus = "READY_FOR_HUMAN_REVIEW" | "APPROVED" | "REJECTED" | "NEEDS_CHANGES";
export type EvidenceStatus = "PASS" | "VERIFIED" | "REVIEW_REQUIRED" | "MISSING" | "CONFLICT" | "UNSUPPORTED" | "NOT_AVAILABLE";

export type ReviewRow = {
  reelId: string;
  songTitle: string;
  collection: string;
  tier: string;
  aiScore: number | null;
  editorialQuality: number | null;
  bibleStatus: EvidenceStatus;
  rightsStatus: string;
  editorialStatus: ReviewStatus | null;
  reviewQueue?: "FAST_PATH" | "STANDARD_REVIEW";
  contentPillar?: string | null;
  seasonality?: string | null;
  contentReady: boolean;
  publicationStatus: string;
  lastReviewedAt: string | null;
  coverUrl: string | null;
};

export type QueueCounts = Partial<Record<ReviewQueueKey, number>>;

export type ReviewWorkspaceData = {
  rows: ReviewRow[];
  counts: QueueCounts;
  connected: boolean;
  sourceLabel: string;
};

export const REVIEW_QUEUES: ReadonlyArray<{ key: ReviewQueueKey; label: string }> = [
  { key: "PENDING", label: "Pending" },
  { key: "FAST_PATH", label: "Fast path" },
  { key: "STANDARD_REVIEW", label: "Standard" },
  { key: "NEEDS_CHANGES", label: "Needs changes" },
  { key: "APPROVED", label: "Approved" },
  { key: "CONTENT_READY", label: "Content ready" },
  { key: "PUBLISHED", label: "Published" },
];
