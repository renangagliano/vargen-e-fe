import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminIdentity } from "./auth.ts";
import type { PublicationAcquireResult, PublicationAnalytics, PublicationAttempt, PublicationSnapshot, PublicationState } from "./publication-contract.ts";

type RpcClient = Pick<SupabaseClient, "rpc">;

function domainError(error: { message?: string } | null): Error {
  const code = error?.message?.match(/[A-Z][A-Z0-9_]{3,}/)?.[0];
  return new Error(code ?? "REMOTE_PUBLICATION_DATABASE_FAILED");
}

function attemptFrom(value: unknown): PublicationAttempt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("REMOTE_PUBLICATION_INVALID_RESPONSE");
  const row = value as Record<string, unknown>;
  return {
    publication_key: String(row.publication_key), reel_id: String(row.reel_id), editorial_version: Number(row.editorial_version),
    status: String(row.status) as PublicationState, attempt_count: Number(row.attempt_count ?? 0),
    container_id: row.container_id ? String(row.container_id) : null, remote_media_id: row.remote_media_id ? String(row.remote_media_id) : null,
    permalink: row.permalink ? String(row.permalink) : null, published_at: row.published_at ? String(row.published_at) : null,
    snapshot: row.snapshot && typeof row.snapshot === "object" ? row.snapshot as PublicationSnapshot : null,
    cleanup_status: String(row.cleanup_status ?? "NOT_REQUESTED"), analytics_status: String(row.analytics_status ?? "NOT_REQUESTED"),
  };
}

export type PublicationTransition = {
  publicationKey: string;
  actorId: string;
  requestId: string;
  eventType: string;
  status?: PublicationState;
  snapshot?: PublicationSnapshot;
  containerId?: string;
  remoteMediaId?: string;
  permalink?: string;
  publishedAt?: string;
  errorCode?: string;
  errorMessageSafe?: string;
  cleanupStatus?: string;
  analyticsStatus?: string;
  metadata?: Record<string, unknown>;
};

export interface PublicationRepository {
  acquire(input: { reelId: string; expectedVersion: number; publicationKey: string; actor: AdminIdentity; requestId: string; targetAccount: string }): Promise<PublicationAcquireResult>;
  transition(input: PublicationTransition): Promise<PublicationAttempt>;
  recordAnalyticsBaseline?(input: { publicationKey: string; reelId: string; mediaId: string; publishedAt: string; observationWindow: string; snapshot: PublicationAnalytics }): Promise<void>;
}

export class SupabasePublicationRepository implements PublicationRepository {
  public constructor(private readonly client: SupabaseClient) {}

  async acquire(input: { reelId: string; expectedVersion: number; publicationKey: string; actor: AdminIdentity; requestId: string; targetAccount: string }): Promise<PublicationAcquireResult> {
    const { data, error } = await this.client.rpc("admin_publication_acquire", {
      p_reel_id: input.reelId, p_editorial_version: input.expectedVersion, p_publication_key: input.publicationKey,
      p_actor_id: input.actor.userId, p_actor_role: input.actor.role, p_request_id: input.requestId, p_target_account: input.targetAccount,
    });
    if (error) throw domainError(error);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("REMOTE_PUBLICATION_INVALID_RESPONSE");
    const result = data as Record<string, unknown>;
    return {
      status: String(result.status) as PublicationAcquireResult["status"], publication_key: String(result.publication_key),
      blockers: Array.isArray(result.blockers) ? result.blockers.map(String) : undefined,
      attempt: result.attempt ? attemptFrom(result.attempt) : undefined,
      snapshot: result.snapshot && typeof result.snapshot === "object" ? result.snapshot as PublicationSnapshot : undefined,
    };
  }

  async transition(input: PublicationTransition): Promise<PublicationAttempt> {
    const { data, error } = await this.client.rpc("admin_publication_transition", {
      p_publication_key: input.publicationKey, p_actor_id: input.actorId, p_request_id: input.requestId,
      p_event_type: input.eventType, p_status: input.status ?? null, p_snapshot: input.snapshot ?? null,
      p_container_id: input.containerId ?? null, p_remote_media_id: input.remoteMediaId ?? null,
      p_permalink: input.permalink ?? null, p_published_at: input.publishedAt ?? null,
      p_error_code: input.errorCode ?? null, p_error_message_safe: input.errorMessageSafe ?? null,
      p_cleanup_status: input.cleanupStatus ?? null, p_analytics_status: input.analyticsStatus ?? null,
      p_metadata: input.metadata ?? {},
    });
    if (error) throw domainError(error);
    return attemptFrom(data);
  }

  async recordAnalyticsBaseline(input: { publicationKey: string; reelId: string; mediaId: string; publishedAt: string; observationWindow: string; snapshot: PublicationAnalytics }): Promise<void> {
    const { error } = await this.client.from("analytics_snapshots").upsert({
      analytics_snapshot_id: `analytics:${input.publicationKey}:${input.observationWindow}`,
      reel_id: input.reelId,
      publication_key: input.publicationKey,
      instagram_media_id: input.mediaId,
      observation_window: input.observationWindow,
      captured_at: new Date().toISOString(),
      source_timestamp: input.publishedAt,
      api_version: process.env.META_GRAPH_API_VERSION?.trim() || "unknown",
      status: input.snapshot.status,
      metrics: input.snapshot.metrics ?? {},
      created_at: new Date().toISOString(),
    }, { onConflict: "analytics_snapshot_id" });
    if (error) throw new Error("ANALYTICS_BASELINE_PERSIST_FAILED");
  }
}
