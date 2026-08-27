import type { QueueCounts, ReviewQueueKey, ReviewRow } from "./review-types.ts";

export type ReviewFilters = {
  search?: string;
  collection?: string;
  tier?: string;
  bibleStatus?: string;
  rightsStatus?: string;
  editorialStatus?: string;
  contentPillar?: string;
  seasonality?: string;
  publicationStatus?: string;
};

export type ReviewSortKey = "songTitle" | "collection" | "tier" | "aiScore" | "editorialQuality" | "bibleStatus" | "publicationStatus" | "lastReviewedAt";

const text = (value: unknown) => String(value ?? "").toLocaleLowerCase("pt-BR");

export function filterReviewRows(rows: ReviewRow[], filters: ReviewFilters): ReviewRow[] {
  const search = text(filters.search).trim();
  return rows.filter((row) => {
    const haystack = text(`${row.reelId} ${row.songTitle} ${row.collection}`);
    return (!search || haystack.includes(search))
      && (!filters.collection || row.collection === filters.collection)
      && (!filters.tier || row.tier === filters.tier)
      && (!filters.bibleStatus || row.bibleStatus === filters.bibleStatus)
      && (!filters.rightsStatus || row.rightsStatus === filters.rightsStatus)
      && (!filters.editorialStatus || row.editorialStatus === filters.editorialStatus)
      && (!filters.contentPillar || row.contentPillar === filters.contentPillar)
      && (!filters.seasonality || row.seasonality === filters.seasonality)
      && (!filters.publicationStatus || row.publicationStatus === filters.publicationStatus);
  });
}

export function sortReviewRows(rows: ReviewRow[], key: ReviewSortKey, direction: "asc" | "desc" = "asc"): ReviewRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = left[key];
    const b = right[key];
    if (a === b) return left.reelId.localeCompare(right.reelId);
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    if (typeof a === "number" && typeof b === "number") return (a - b) * sign;
    return text(a).localeCompare(text(b), "pt-BR") * sign;
  });
}

/** Returns the next visible, unpublished candidate in the current queue order. */
export function nextReviewRow(rows: ReviewRow[], currentReelId: string): ReviewRow | null {
  const currentIndex = rows.findIndex((row) => row.reelId === currentReelId);
  const ordered = currentIndex < 0 ? rows : [...rows.slice(currentIndex + 1), ...rows.slice(0, currentIndex)];
  return ordered.find((row) => row.publicationStatus !== "PUBLISHED") ?? null;
}

export function queueCounts(rows: ReviewRow[]): QueueCounts {
  const counts: QueueCounts = {};
  for (const row of rows) {
    const keys: ReviewQueueKey[] = [];
    if (row.reviewQueue) keys.push(row.reviewQueue);
    if (!row.editorialStatus || row.editorialStatus === "READY_FOR_HUMAN_REVIEW") keys.push("PENDING");
    if (row.contentReady) keys.push("CONTENT_READY");
    if (row.editorialStatus === "NEEDS_CHANGES") keys.push("NEEDS_CHANGES");
    if (row.editorialStatus === "APPROVED") keys.push("APPROVED");
    if (row.publicationStatus === "PUBLISHED") keys.push("PUBLISHED");
    for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function queueMatches(row: ReviewRow, queue: ReviewQueueKey): boolean {
  if (queue === "PENDING") return !row.editorialStatus || row.editorialStatus === "READY_FOR_HUMAN_REVIEW";
  if (queue === "CONTENT_READY") return row.contentReady;
  if (queue === "NEEDS_CHANGES") return row.editorialStatus === "NEEDS_CHANGES";
  if (queue === "APPROVED") return row.editorialStatus === "APPROVED";
  if (queue === "PUBLISHED") return row.publicationStatus === "PUBLISHED";
  return row.reviewQueue === queue;
}
