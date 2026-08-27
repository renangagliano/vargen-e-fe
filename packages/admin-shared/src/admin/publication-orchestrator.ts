import type { AdminIdentity } from "./auth.ts";
import type { PublicationRepository } from "./publication-repository.ts";
import type { PublicationAnalytics, PublicationAttempt, PublicationSnapshot } from "./publication-contract.ts";

export type PreparedPublicationMedia = {
  url: string;
  provider: string;
  itemId: string;
  checksumSha256: string;
  sizeBytes: number;
  expiresAt: string;
  cleanupAllowed: boolean;
  permissionId?: string | null;
};

export type PublicationMediaGateway = {
  prepare(snapshot: PublicationSnapshot): Promise<PreparedPublicationMedia>;
  cleanup(media: PreparedPublicationMedia): Promise<"SUCCEEDED" | "PENDING">;
  cleanupSnapshot?(snapshot: PublicationSnapshot): Promise<"SUCCEEDED" | "PENDING">;
};

export type PublicationMetaGateway = {
  createReelContainer(input: { videoUrl: string; caption: string }): Promise<{ containerId: string }>;
  getContainerStatus(containerId: string): Promise<{ status: "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED"; errorMessageSafe?: string }>;
  publishContainer(containerId: string): Promise<{ mediaId: string }>;
  readPublication(mediaId: string): Promise<{ id: string; username?: string; media_product_type?: string; permalink?: string; timestamp?: string }>;
  getMediaInsights?(mediaId: string): Promise<PublicationAnalytics>;
};

export type PublicationResult = {
  status: "PUBLISHED" | "ALREADY_PUBLISHED" | "RESUMED";
  publication: PublicationAttempt | null;
  permalink?: string | null;
  published_media_id?: string | null;
  cleanup_status?: "SUCCEEDED" | "PENDING" | "NOT_REQUESTED";
  analytics_status?: "COLLECTED" | "FAILED" | "NOT_REQUESTED";
};

export class PublicationPipelineError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown>;

  public constructor(code: string, details: Record<string, unknown> = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

const REQUIRED_GATES = ["technical_validation", "source_integrity", "editorial_review", "rights_status", "bible_reference", "output_file_exists", "cover_exists", "required_editorial_fields", "duplicate_publication_check"] as const;

function assertReady(snapshot: PublicationSnapshot): void {
  const blockers = REQUIRED_GATES.filter((key) => snapshot.readiness_gates[key] !== "PASS");
  if (blockers.length) throw new PublicationPipelineError("PUBLICATION_NOT_READY", { blockers });
}

async function waitForFinished(meta: PublicationMetaGateway, containerId: string, intervalMs: number, timeoutMs: number): Promise<"FINISHED" | "ERROR" | "EXPIRED"> {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const state = await meta.getContainerStatus(containerId);
    if (state.status !== "IN_PROGRESS") return state.status;
    if (intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new PublicationPipelineError("META_PROCESSING_TIMEOUT");
}

export async function executeAdminPublication(input: {
  repository: PublicationRepository;
  media: PublicationMediaGateway;
  meta: PublicationMetaGateway;
  actor: AdminIdentity;
  requestId: string;
  reelId: string;
  expectedVersion: number;
  publicationKey: string;
  targetAccount: string;
  now?: () => string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}): Promise<PublicationResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const acquired = await input.repository.acquire({ reelId: input.reelId, expectedVersion: input.expectedVersion, publicationKey: input.publicationKey, actor: input.actor, requestId: input.requestId, targetAccount: input.targetAccount });
  if (acquired.status === "BLOCKED") throw new PublicationPipelineError("PUBLICATION_NOT_READY", { blockers: acquired.blockers ?? [] });
  if (acquired.status === "ALREADY_PUBLISHED") return { status: "ALREADY_PUBLISHED", publication: acquired.attempt ?? null, permalink: acquired.attempt?.permalink, published_media_id: acquired.attempt?.remote_media_id, cleanup_status: "NOT_REQUESTED", analytics_status: "NOT_REQUESTED" };
  const attempt = acquired.attempt;
  if (attempt?.status === "PUBLISHING" || attempt?.status === "UNCERTAIN" || (acquired.status === "ACTIVE_ATTEMPT" && attempt?.status === "PREPARING")) throw new PublicationPipelineError("PUBLICATION_STATE_UNCERTAIN", { publication_key: input.publicationKey });
  let snapshot = acquired.snapshot ?? attempt?.snapshot;
  if (!snapshot) throw new PublicationPipelineError("PUBLICATION_SNAPSHOT_MISSING");
  assertReady(snapshot);
  const workingAttempt = attempt ?? null;
  let containerId = workingAttempt?.container_id ?? null;
  let media: PreparedPublicationMedia | null = null;
  if (!containerId) {
    try { media = await input.media.prepare(snapshot); }
    catch (error) { await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "PUBLICATION_FAILED", status: "FAILED_PRE_META", errorCode: error instanceof PublicationPipelineError ? error.code : "TEMP_MEDIA_VALIDATION_FAILED", errorMessageSafe: "A mídia temporária não pôde ser validada antes da publicação." }); throw new PublicationPipelineError(error instanceof PublicationPipelineError ? error.code : "TEMP_MEDIA_VALIDATION_FAILED"); }
    snapshot = { ...snapshot, derived_checksum: media.checksumSha256, temporary_media_item_id: media.itemId, temporary_media_permission_id: media.permissionId ?? null };
    await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "TEMP_MEDIA_RESOLVED", snapshot, metadata: { provider: media.provider, item_id_present: Boolean(media.itemId) } });
    await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "TEMP_MEDIA_VALIDATED", snapshot, metadata: { provider: media.provider, size_bytes: media.sizeBytes, checksum_present: true } });
    try { containerId = (await input.meta.createReelContainer({ videoUrl: media.url, caption: snapshot.caption })).containerId; }
    catch { await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "PUBLICATION_FAILED", status: "FAILED", errorCode: "META_CONTAINER_CREATE_FAILED", errorMessageSafe: "O container do Instagram não pôde ser criado." }); throw new PublicationPipelineError("META_CONTAINER_CREATE_FAILED"); }
    await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "META_CONTAINER_CREATED", status: "CONTAINER_CREATED", containerId, metadata: { provider: media.provider } });
  }
  await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "META_PROCESSING_STARTED", status: "PROCESSING", containerId });
  let processing: "FINISHED" | "ERROR" | "EXPIRED";
  try {
    processing = await waitForFinished(input.meta, containerId, input.pollIntervalMs ?? 5000, input.pollTimeoutMs ?? 120000);
  } catch (error) {
    const code = error instanceof PublicationPipelineError ? error.code : "META_PROCESSING_TIMEOUT";
    await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "PUBLICATION_FAILED", status: "FAILED", containerId, errorCode: code, errorMessageSafe: "O processamento do Instagram excedeu o tempo limite; nenhum novo container será criado automaticamente." });
    throw new PublicationPipelineError(code);
  }
  if (processing !== "FINISHED") { const code = processing === "ERROR" ? "META_PROCESSING_ERROR" : "META_PROCESSING_EXPIRED"; await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "PUBLICATION_FAILED", status: "FAILED", containerId, errorCode: code, errorMessageSafe: "O Instagram não concluiu o processamento do container." }); throw new PublicationPipelineError(code); }
  await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "META_PROCESSING_FINISHED", status: "PROCESSING", containerId });
  await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "MEDIA_PUBLISH_STARTED", status: "PUBLISHING", containerId });
  let mediaId: string;
  try { mediaId = (await input.meta.publishContainer(containerId)).mediaId; }
  catch { await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "PUBLICATION_UNCERTAIN", status: "UNCERTAIN", containerId, errorCode: "PUBLICATION_STATE_UNCERTAIN", errorMessageSafe: "A resposta da publicação ficou ambígua; investigue o estado remoto antes de repetir." }); throw new PublicationPipelineError("PUBLICATION_STATE_UNCERTAIN"); }
  await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "MEDIA_PUBLISH_RETURNED", status: "PUBLISHING", containerId, remoteMediaId: mediaId });
  let readback;
  try { readback = await input.meta.readPublication(mediaId); } catch {
    await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "PUBLICATION_UNCERTAIN", status: "UNCERTAIN", containerId, remoteMediaId: mediaId, errorCode: "READBACK_FAILED", errorMessageSafe: "A publicação foi enviada, mas a confirmação remota falhou; investigue antes de repetir." });
    throw new PublicationPipelineError("READBACK_FAILED");
  }
  if (readback.id !== mediaId || !readback.permalink || (readback.media_product_type && readback.media_product_type.toUpperCase() !== "REELS")) {
    await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "PUBLICATION_UNCERTAIN", status: "UNCERTAIN", containerId, remoteMediaId: mediaId, errorCode: "READBACK_FAILED", errorMessageSafe: "A resposta remota não confirmou um Reel publicável; investigue antes de repetir." });
    throw new PublicationPipelineError("READBACK_FAILED");
  }
  await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "PUBLICATION_READBACK_CONFIRMED", status: "PUBLISHING", containerId, remoteMediaId: mediaId, permalink: readback.permalink, publishedAt: readback.timestamp ?? now() });
  let publication = await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "PUBLICATION_MARKED_PUBLISHED", status: "PUBLISHED", containerId, remoteMediaId: mediaId, permalink: readback.permalink, publishedAt: readback.timestamp ?? now() });
  let cleanupStatus: "SUCCEEDED" | "PENDING" | "NOT_REQUESTED" = "NOT_REQUESTED";
  if (media) {
    try { cleanupStatus = await input.media.cleanup(media); } catch { cleanupStatus = "PENDING"; }
    await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: cleanupStatus === "SUCCEEDED" ? "TEMP_MEDIA_CLEANUP_SUCCEEDED" : "TEMP_MEDIA_CLEANUP_FAILED", cleanupStatus, metadata: { provider: media.provider } });
  } else if (input.media.cleanupSnapshot && snapshot.temporary_media_item_id) {
    try { cleanupStatus = await input.media.cleanupSnapshot(snapshot); } catch { cleanupStatus = "PENDING"; }
    await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: cleanupStatus === "SUCCEEDED" ? "TEMP_MEDIA_CLEANUP_SUCCEEDED" : "TEMP_MEDIA_CLEANUP_FAILED", cleanupStatus, metadata: { provider: "onedrive-personal", resumed: true } });
  }
  let analyticsStatus: "COLLECTED" | "FAILED" | "NOT_REQUESTED" = "NOT_REQUESTED";
  if (input.meta.getMediaInsights) {
    try {
      const insights = await input.meta.getMediaInsights(mediaId);
      analyticsStatus = insights.status === "AVAILABLE" ? "COLLECTED" : "FAILED";
      if (input.repository.recordAnalyticsBaseline) {
        await input.repository.recordAnalyticsBaseline({ publicationKey: input.publicationKey, reelId: input.reelId, mediaId, publishedAt: readback.timestamp ?? now(), observationWindow: "initial", snapshot: insights });
      }
      await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "ANALYTICS_BASELINE_COLLECTED", analyticsStatus, metadata: { observation_window: "initial", source_status: insights.status } });
    } catch { analyticsStatus = "FAILED"; await input.repository.transition({ publicationKey: input.publicationKey, actorId: input.actor.userId, requestId: input.requestId, eventType: "ANALYTICS_BASELINE_COLLECTED", analyticsStatus, metadata: { observation_window: "initial", failure: true } }); }
  }
  publication = { ...publication, cleanup_status: cleanupStatus, analytics_status: analyticsStatus };
  return { status: acquired.status === "ACTIVE_ATTEMPT" ? "RESUMED" : "PUBLISHED", publication, permalink: readback.permalink, published_media_id: mediaId, cleanup_status: cleanupStatus, analytics_status: analyticsStatus };
}
