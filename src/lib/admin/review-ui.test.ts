import assert from "node:assert/strict";
import test from "node:test";
import { candidateDetailUrl, fetchCandidateDetail, formatReviewStatus, reviewStatusTone } from "./review-ui.ts";

test("review UI formats long persisted statuses into readable labels", () => {
  assert.equal(formatReviewStatus("RIGHTS_PENDING_CONFIRMATION"), "Pending");
  assert.equal(formatReviewStatus("READY_FOR_HUMAN_REVIEW"), "Human review");
  assert.equal(reviewStatusTone("PUBLISHED"), "good");
  assert.equal(reviewStatusTone("REVIEW_REQUIRED"), "warning");
  assert.equal(reviewStatusTone("REJECTED"), "danger");
});

test("candidate detail URLs encode the exact Reel identifier", () => {
  assert.equal(candidateDetailUrl("/api/admin/candidates/", "reel-abc-123"), "/api/admin/candidates/reel-abc-123");
  assert.equal(candidateDetailUrl("/api/admin/candidates", "reel-a/b"), "/api/admin/candidates/reel-a%2Fb");
});

test("candidate detail loader returns valid API payloads and exposes safe failures", async () => {
  let requestInit: RequestInit | undefined;
  const request = async (_input: RequestInfo | URL, init?: RequestInit) => { requestInit = init; return new Response(JSON.stringify({ reel_id: "reel-abc-123" }), { status: 200 }); };
  assert.deepEqual(await fetchCandidateDetail("/api/admin/candidates", "reel-abc-123", request), { reel_id: "reel-abc-123" });
  assert.equal(requestInit?.cache, "no-store");
  assert.equal(requestInit?.credentials, "same-origin");
  await assert.rejects(() => fetchCandidateDetail("/api/admin/candidates", "reel-abc-123", async () => new Response(JSON.stringify({ error: "ADMIN_AUTH_REQUIRED" }), { status: 401 })), /ADMIN_AUTH_REQUIRED/);
  await assert.rejects(() => fetchCandidateDetail("/api/admin/candidates", "reel-abc-123", async () => new Response("not-json", { status: 200 })), /CANDIDATE_DETAIL_INVALID/);
});
