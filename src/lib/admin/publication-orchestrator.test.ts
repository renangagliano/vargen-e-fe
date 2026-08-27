import assert from "node:assert/strict";
import test from "node:test";
import { executeAdminPublication, type PublicationMediaGateway, type PublicationMetaGateway } from "../../../packages/admin-shared/src/admin/publication-orchestrator.ts";
import type { PublicationAcquireResult, PublicationAttempt, PublicationSnapshot } from "../../../packages/admin-shared/src/admin/publication-contract.ts";

const snapshot: PublicationSnapshot = { snapshot_id: "snap-1", snapshot_version: "test", publication_key: "instagram:reel-1:1:hash", reel_id: "reel-1", asset_id: "asset-1", editorial_version: 1, title: "Title", caption: "Caption #tag", hashtags: ["#tag"], cta: "CTA", bible_reference: "João 20:8", rights_status: "RIGHTS_CONFIRMED", content_ready_evaluation_id: "eval-1", readiness_gates: { technical_validation: "PASS", source_integrity: "PASS", editorial_review: "PASS", rights_status: "PASS", bible_reference: "PASS", output_file_exists: "PASS", cover_exists: "PASS", required_editorial_fields: "PASS", duplicate_publication_check: "PASS" }, source_checksum: "source", derived_checksum: null, media_relative_path: "reel.mp4", media_size: 4, target_account: "account", operator_user_id: "admin", operator_role: "ADMIN", authorized_at: "2026-01-01T00:00:00Z", request_id: "request-1" };

function repo() {
  const events: string[] = [];
  const attempt: PublicationAttempt = { publication_key: snapshot.publication_key, reel_id: snapshot.reel_id, editorial_version: 1, status: "PREPARING", attempt_count: 1, container_id: null, remote_media_id: null, permalink: null, published_at: null, snapshot, cleanup_status: "NOT_REQUESTED", analytics_status: "NOT_REQUESTED" };
  return { events, acquire: async (): Promise<PublicationAcquireResult> => ({ status: "LOCK_ACQUIRED", publication_key: snapshot.publication_key, snapshot, attempt }), transition: async (input: { eventType: string; status?: string; [key: string]: unknown }) => { events.push(input.eventType); return { ...attempt, status: (input.status ?? attempt.status) as PublicationAttempt["status"], container_id: typeof input.containerId === "string" ? input.containerId : attempt.container_id, remote_media_id: typeof input.remoteMediaId === "string" ? input.remoteMediaId : attempt.remote_media_id, permalink: typeof input.permalink === "string" ? input.permalink : attempt.permalink }; } };
}

test("controlled publish runs one container, one media_publish and read-back", async () => {
  const repository = repo();
  let created = 0; let published = 0;
  const media: PublicationMediaGateway = { prepare: async () => ({ url: "https://1drv.ms/media", provider: "onedrive-personal", itemId: "item", checksumSha256: "derived", sizeBytes: 4, expiresAt: "2026-01-01T01:00:00Z", cleanupAllowed: false }), cleanup: async () => "SUCCEEDED" };
  const meta: PublicationMetaGateway = { createReelContainer: async () => { created += 1; return { containerId: "container" }; }, getContainerStatus: async () => ({ status: "FINISHED" }), publishContainer: async () => { published += 1; return { mediaId: "media" }; }, readPublication: async () => ({ id: "media", media_product_type: "REELS", permalink: "https://instagram.com/reel/1", timestamp: "2026-01-01T00:00:00Z" }) };
  const result = await executeAdminPublication({ repository: repository as never, media, meta, actor: { userId: "admin", role: "ADMIN", email: null }, requestId: "request-1", reelId: "reel-1", expectedVersion: 1, publicationKey: snapshot.publication_key, targetAccount: "account", pollIntervalMs: 0 });
  assert.equal(result.status, "PUBLISHED"); assert.equal(created, 1); assert.equal(published, 1); assert.ok(repository.events.includes("PUBLICATION_MARKED_PUBLISHED"));
});

test("uncertain existing attempt never calls Meta again", async () => {
  const attempt = { ...repo(), acquire: async () => ({ status: "ACTIVE_ATTEMPT", publication_key: snapshot.publication_key, attempt: { publication_key: snapshot.publication_key, reel_id: snapshot.reel_id, editorial_version: 1, status: "UNCERTAIN", attempt_count: 1, container_id: "container", remote_media_id: null, permalink: null, published_at: null, snapshot, cleanup_status: "NOT_REQUESTED", analytics_status: "NOT_REQUESTED" } }) };
  await assert.rejects(() => executeAdminPublication({ repository: attempt as never, media: {} as never, meta: {} as never, actor: { userId: "admin", role: "ADMIN", email: null }, requestId: "request-2", reelId: "reel-1", expectedVersion: 1, publicationKey: snapshot.publication_key, targetAccount: "account" }), /PUBLICATION_STATE_UNCERTAIN/);
});
