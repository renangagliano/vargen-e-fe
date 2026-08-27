import type { SupabaseClient } from "@supabase/supabase-js";
import { filterReviewRows, type ReviewFilters } from "./review-queue";
import type { ReviewRow, ReviewWorkspaceData } from "./review-types";

export interface GovernanceRepository {
  getReviewQueue(filters?: ReviewFilters): Promise<ReviewWorkspaceData>;
  getCandidateDetail(reelId: string): Promise<Record<string, unknown> | null>;
  getAnalytics(reelId: string): Promise<ReadonlyArray<Record<string, unknown>>>;
  getPublicationHistory(reelId: string): Promise<ReadonlyArray<Record<string, unknown>>>;
}

function toReviewRow(value: Record<string, unknown>): ReviewRow {
  return {
    reelId: String(value.reel_id), songTitle: String(value.song_title ?? value.reel_id), collection: String(value.collection ?? "—"), tier: String(value.tier ?? "—"),
    aiScore: typeof value.ai_score === "number" ? value.ai_score : null, editorialQuality: typeof value.editorial_quality === "number" ? value.editorial_quality : null,
    bibleStatus: String(value.bible_status ?? "MISSING") as ReviewRow["bibleStatus"], rightsStatus: String(value.rights_status ?? "UNKNOWN"), editorialStatus: (value.editorial_status as ReviewRow["editorialStatus"]) ?? null,
    reviewQueue: value.review_queue === "FAST_PATH" || value.review_queue === "STANDARD_REVIEW" ? value.review_queue : undefined,
    contentPillar: value.content_pillar ? String(value.content_pillar) : null, seasonality: value.seasonality ? String(value.seasonality) : null,
    contentReady: value.content_ready === true, publicationStatus: String(value.publication_status ?? "NOT_PUBLISHED"), lastReviewedAt: value.last_reviewed_at ? String(value.last_reviewed_at) : null, coverUrl: null,
  };
}

export class SupabaseGovernanceRepository implements GovernanceRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getReviewQueue(filters: ReviewFilters = {}): Promise<ReviewWorkspaceData> {
    const result = await this.client.from("derived_reels").select("reel_id,song_title,collection,tier,ai_score,editorial_quality,bible_status,rights_status,editorial_status,review_queue,content_pillar,seasonality,content_ready,publication_status,last_reviewed_at").limit(500);
    if (result.error) throw new Error("REMOTE_QUEUE_READ_FAILED");
    const rows = (result.data ?? []).map((value) => toReviewRow(value as Record<string, unknown>));
    const visible = filterReviewRows(rows, filters);
    return { rows: visible, counts: {}, connected: true, sourceLabel: "Supabase read-only" };
  }

  async getCandidateDetail(reelId: string) { const result = await this.client.from("derived_reels").select("*").eq("reel_id", reelId).maybeSingle(); if (result.error) throw new Error("REMOTE_CANDIDATE_READ_FAILED"); return result.data as Record<string, unknown> | null; }
  async getAnalytics(reelId: string) { const result = await this.client.from("analytics_snapshots").select("*").eq("reel_id", reelId).order("captured_at", { ascending: false }); if (result.error) throw new Error("REMOTE_ANALYTICS_READ_FAILED"); return (result.data ?? []) as Record<string, unknown>[]; }
  async getPublicationHistory(reelId: string) { const result = await this.client.from("publication_records").select("*").eq("reel_id", reelId).order("created_at", { ascending: false }); if (result.error) throw new Error("REMOTE_PUBLICATION_READ_FAILED"); return (result.data ?? []) as Record<string, unknown>[]; }
}

