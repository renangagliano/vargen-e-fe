import type { SupabaseClient } from "@supabase/supabase-js";
import { filterReviewRows, queueCounts, type ReviewFilters } from "./review-queue.ts";
import type { ReviewRow, ReviewWorkspaceData } from "./review-types.ts";
import type { AdminIdentity } from "./auth.ts";
import type { GovernanceMutationRequest } from "./mutation-contract.ts";
import { resolveEffectiveBibleStatus, resolveEffectiveRightsStatus } from "./governance-state.ts";

export interface GovernanceRepository {
  getReviewQueue(filters?: ReviewFilters): Promise<ReviewWorkspaceData>;
  getCandidateDetail(reelId: string): Promise<Record<string, unknown> | null>;
  getAnalytics(reelId: string): Promise<ReadonlyArray<Record<string, unknown>>>;
  getPublicationHistory(reelId: string): Promise<ReadonlyArray<Record<string, unknown>>>;
}

export type GovernanceMutationResult = {
  action: string;
  reel_id: string;
  editorial_version: number;
  state: Record<string, unknown>;
  readiness?: Record<string, unknown>;
  idempotent?: boolean;
  publication_authorization?: Record<string, unknown> | null;
};

type RpcClient = Pick<SupabaseClient, "rpc">;

/**
 * All remote writes go through one server-side PostgreSQL function. The
 * function is deliberately not part of the browser client and is granted to
 * the service role only. This keeps the multi-table governance operation
 * transactional while the application remains fail-closed until the remote
 * write flag is explicitly enabled.
 */
export class SupabaseGovernanceMutationRepository {
  private readonly client: RpcClient;

  constructor(client: RpcClient) {
    this.client = client;
  }

  async execute(request: GovernanceMutationRequest, identity: AdminIdentity): Promise<GovernanceMutationResult> {
    const { data, error } = await this.client.rpc("admin_governance_mutation", {
      p_action: request.action,
      p_reel_id: request.reel_id,
      p_expected_current_version: request.expected_current_version,
      p_actor_id: identity.userId,
      p_request_id: request.request_id,
      p_payload: {
        ...(request.fields ?? {}),
        confirmation_statement: request.confirmation_statement,
        confirm_publication: request.confirm_publication,
        confirm_rejection: request.confirm_rejection,
      },
    });
    if (error) {
      const code = error.message.match(/[A-Z][A-Z0-9_]{3,}/)?.[0];
      throw new Error(code ?? "REMOTE_GOVERNANCE_MUTATION_FAILED");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("REMOTE_GOVERNANCE_MUTATION_INVALID_RESPONSE");
    return data as GovernanceMutationResult;
  }
}

function toReviewRow(value: Record<string, unknown>): ReviewRow {
  return {
    reelId: String(value.reel_id), songTitle: String(value.song_title ?? value.reel_id), collection: String(value.collection ?? "—"), tier: String(value.tier ?? "—"),
    aiScore: typeof value.ai_score === "number" ? value.ai_score : null, editorialQuality: typeof value.editorial_quality === "number" ? value.editorial_quality : null,
    bibleStatus: String(value.effective_bible_status ?? value.bible_status ?? "MISSING") as ReviewRow["bibleStatus"], rightsStatus: String(value.effective_rights_status ?? value.rights_status ?? "UNKNOWN"), editorialStatus: (value.editorial_status as ReviewRow["editorialStatus"]) ?? null,
    reviewQueue: value.review_queue === "FAST_PATH" || value.review_queue === "STANDARD_REVIEW" ? value.review_queue : undefined,
    contentPillar: value.content_pillar ? String(value.content_pillar) : null, seasonality: value.seasonality ? String(value.seasonality) : null,
    contentReady: value.content_ready === true, publicationStatus: String(value.publication_status ?? "NOT_PUBLISHED"), lastReviewedAt: value.last_reviewed_at ? String(value.last_reviewed_at) : null, coverUrl: null,
  };
}

export class SupabaseGovernanceRepository implements GovernanceRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async getReviewQueue(filters: ReviewFilters = {}): Promise<ReviewWorkspaceData> {
    const result = await this.client.from("derived_reels").select("reel_id,source_asset_id,song_title,collection,tier,ai_score,editorial_quality,bible_status,rights_status,editorial_status,review_queue,content_pillar,seasonality,content_ready,publication_status,last_reviewed_at").limit(500);
    if (result.error) throw new Error("REMOTE_QUEUE_READ_FAILED");
    const [editorials, evidence, verifications, rightsSources, readiness] = await Promise.all([
      this.client.from("editorial_versions").select("reel_id,editorial_version,bible_reference").limit(1000),
      this.client.from("bible_evidence").select("reel_id,editorial_version,evidence_status").limit(1000),
      this.client.from("bible_verifications").select("reel_id,editorial_version").limit(1000),
      this.client.from("rights_sources").select("asset_id,rights_confirmations(rights_status)").limit(1000),
      this.client.from("content_ready_evaluations").select("reel_id,editorial_version,status,evaluated_at").order("evaluated_at", { ascending: false }).limit(1000),
    ]);
    if (editorials.error || evidence.error || verifications.error || rightsSources.error || readiness.error) throw new Error("REMOTE_QUEUE_READ_FAILED");
    const latestEditorial = new Map<string, Record<string, unknown>>();
    for (const value of editorials.data ?? []) {
      const row = value as Record<string, unknown>;
      const current = latestEditorial.get(String(row.reel_id));
      if (!current || Number(row.editorial_version) > Number(current.editorial_version)) latestEditorial.set(String(row.reel_id), row);
    }
    const evidenceByVersion = new Map<string, Record<string, unknown>>((evidence.data ?? []).map((value) => { const row = value as Record<string, unknown>; return [`${row.reel_id}:${row.editorial_version}`, row]; }));
    const verificationByVersion = new Map<string, Record<string, unknown>>((verifications.data ?? []).map((value) => { const row = value as Record<string, unknown>; return [`${row.reel_id}:${row.editorial_version}`, row]; }));
    const rightsByAsset = new Map<string, { sourceExists: boolean; confirmationStatuses: unknown[] }>();
    for (const value of rightsSources.data ?? []) {
      const row = value as Record<string, unknown>;
      const confirmations = Array.isArray(row.rights_confirmations) ? row.rights_confirmations as Array<Record<string, unknown>> : [];
      const assetId = String(row.asset_id);
      const current = rightsByAsset.get(assetId) ?? { sourceExists: false, confirmationStatuses: [] };
      current.sourceExists = true;
      current.confirmationStatuses.push(...confirmations.map((confirmation) => confirmation.rights_status));
      rightsByAsset.set(assetId, current);
    }
    const readinessByReel = new Map<string, Record<string, unknown>>();
    for (const value of readiness.data ?? []) {
      const row = value as Record<string, unknown>;
      const key = String(row.reel_id);
      const currentVersion = latestEditorial.get(key)?.editorial_version;
      if (currentVersion === undefined || Number(row.editorial_version) !== Number(currentVersion)) continue;
      if (!readinessByReel.has(key)) readinessByReel.set(key, row);
    }
    const rows = (result.data ?? []).map((value) => {
      const raw = value as Record<string, unknown>;
      const reelId = String(raw.reel_id);
      const editorial = latestEditorial.get(reelId);
      const version = editorial?.editorial_version;
      const evidenceRow = evidenceByVersion.get(`${reelId}:${version}`);
      const verificationRow = verificationByVersion.get(`${reelId}:${version}`);
      const rights = rightsByAsset.get(String(raw.source_asset_id ?? "")) ?? { sourceExists: false, confirmationStatuses: [] };
      const effectiveBibleStatus = resolveEffectiveBibleStatus({ reference: editorial?.bible_reference, evidenceStatus: evidenceRow?.evidence_status, evidenceVersion: evidenceRow?.editorial_version, verificationVersion: verificationRow?.editorial_version, editorialVersion: version });
      const effectiveRightsStatus = resolveEffectiveRightsStatus(rights);
      const currentReadiness = readinessByReel.get(reelId);
      return toReviewRow({ ...raw,
        effective_bible_status: effectiveBibleStatus,
        effective_rights_status: effectiveRightsStatus,
        content_ready: currentReadiness?.status === "CONTENT_READY" && effectiveBibleStatus === "VERIFIED" && effectiveRightsStatus === "RIGHTS_CONFIRMED",
      });
    });
    const visible = filterReviewRows(rows, filters);
    return { rows: visible, counts: queueCounts(rows), connected: true, sourceLabel: "Supabase read-only" };
  }

  async getCandidateDetail(reelId: string) {
    const reel = await this.client.from("derived_reels").select("*").eq("reel_id", reelId).maybeSingle();
    if (reel.error) throw new Error("REMOTE_CANDIDATE_READ_FAILED");
    if (!reel.data) return null;
    const sourceAssetId = typeof reel.data.source_asset_id === "string" ? reel.data.source_asset_id : null;
    const editorial = await this.client.from("editorial_versions").select("*").eq("reel_id", reelId).order("editorial_version", { ascending: false }).limit(1).maybeSingle();
    if (editorial.error) throw new Error("REMOTE_CANDIDATE_READ_FAILED");
    const currentVersion = editorial.data?.editorial_version;
    const versionForQueries = typeof currentVersion === "number" ? currentVersion : -1;
    const [evidence, verification, rights, review, readiness] = await Promise.all([
      this.client.from("bible_evidence").select("*").eq("reel_id", reelId).eq("editorial_version", versionForQueries).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      this.client.from("bible_verifications").select("*").eq("reel_id", reelId).eq("editorial_version", versionForQueries).order("verified_at", { ascending: false }).limit(1).maybeSingle(),
      sourceAssetId ? this.client.from("rights_sources").select("*,rights_confirmations(*)").eq("asset_id", sourceAssetId) : Promise.resolve({ data: [], error: null }),
      this.client.from("human_reviews").select("*").eq("reel_id", reelId).eq("editorial_version", versionForQueries).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      this.client.from("content_ready_evaluations").select("*").eq("reel_id", reelId).eq("editorial_version", versionForQueries).order("evaluated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (editorial.error || evidence.error || verification.error || rights.error || review.error || readiness.error) throw new Error("REMOTE_CANDIDATE_READ_FAILED");
    const rightsRows = Array.isArray(rights.data) ? rights.data as Array<Record<string, unknown>> : [];
    const confirmationStatuses = rightsRows.flatMap((source) => Array.isArray(source.rights_confirmations) ? (source.rights_confirmations as Array<Record<string, unknown>>).map((confirmation) => confirmation.rights_status) : []);
    const effectiveBibleStatus = resolveEffectiveBibleStatus({ reference: editorial.data?.bible_reference, evidenceStatus: evidence.data?.evidence_status, evidenceVersion: evidence.data?.editorial_version, verificationVersion: verification.data?.editorial_version, editorialVersion: currentVersion });
    const effectiveRightsStatus = resolveEffectiveRightsStatus({ sourceExists: rightsRows.length > 0, confirmationStatuses });
    const canonicalReadiness = readiness.data?.gates ? { ...readiness.data.gates,
      bible_reference: effectiveBibleStatus === "VERIFIED" ? "PASS" : "BLOCKED",
      rights_status: effectiveRightsStatus === "RIGHTS_CONFIRMED" ? "PASS" : "BLOCKED",
    } : null;
    const storedReadinessStatus = readiness.data?.status ?? null;
    const canonicalReady = storedReadinessStatus === "CONTENT_READY" && effectiveBibleStatus === "VERIFIED" && effectiveRightsStatus === "RIGHTS_CONFIRMED";
    return { ...reel.data, content_ready: canonicalReady, editorial_version: editorial.data, bible_evidence: evidence.data, bible_verification: verification.data, rights: rights.data, review: review.data, readiness: canonicalReadiness, readiness_status: storedReadinessStatus === null ? null : canonicalReady ? "CONTENT_READY" : "BLOCKED",
      effective_bible_status: effectiveBibleStatus,
      effective_rights_status: effectiveRightsStatus,
    } as Record<string, unknown>;
  }

  async getAnalytics(reelId: string) { const result = await this.client.from("analytics_snapshots").select("*").eq("reel_id", reelId).order("captured_at", { ascending: false }); if (result.error) throw new Error("REMOTE_ANALYTICS_READ_FAILED"); return (result.data ?? []) as Record<string, unknown>[]; }
  async getPublicationHistory(reelId: string) { const result = await this.client.from("publication_records").select("*").eq("reel_id", reelId).order("created_at", { ascending: false }); if (result.error) throw new Error("REMOTE_PUBLICATION_READ_FAILED"); return (result.data ?? []) as Record<string, unknown>[]; }
}
