import assert from "node:assert/strict";
import test from "node:test";
import { filterReviewRows, nextReviewRow, queueCounts, queueMatches, sortReviewRows } from "./review-queue.ts";
import type { ReviewRow } from "./review-types.ts";
import { canMutateGovernance, canReadWorkspace, requireRole } from "./auth.ts";
import { PROTECTED_ADMIN_ROUTES, requiredRolesForPath } from "./route-guards.ts";

const row = (overrides: Partial<ReviewRow> = {}): ReviewRow => ({
  reelId: "reel-1", songTitle: "Águas", collection: "12 Meses", tier: "TIER_A", aiScore: 90, editorialQuality: 88,
  bibleStatus: "PASS", rightsStatus: "RIGHTS_CONFIRMED", editorialStatus: "READY_FOR_HUMAN_REVIEW", reviewQueue: "FAST_PATH",
  contentPillar: "FAITH", seasonality: "EVERGREEN", contentReady: false, publicationStatus: "NOT_PUBLISHED", lastReviewedAt: null, coverUrl: null, ...overrides,
});

test("review queue filters are composable and do not mutate the source rows", () => {
  const rows = [row(), row({ reelId: "reel-2", songTitle: "Caminho", bibleStatus: "REVIEW_REQUIRED", reviewQueue: "STANDARD_REVIEW" })];
  const filtered = filterReviewRows(rows, { search: "caminho", bibleStatus: "REVIEW_REQUIRED" });
  assert.deepEqual(filtered.map((item) => item.reelId), ["reel-2"]);
  assert.equal(rows.length, 2);
});

test("review queue sorting is deterministic with nulls last", () => {
  const sorted = sortReviewRows([row({ reelId: "low", aiScore: 40 }), row({ reelId: "high", aiScore: 95 }), row({ reelId: "none", aiScore: null })], "aiScore", "desc");
  assert.deepEqual(sorted.map((item) => item.reelId), ["high", "low", "none"]);
});

test("queue counts and queue membership reflect persisted status", () => {
  const rows = [row(), row({ reelId: "ready", contentReady: true, editorialStatus: "APPROVED", publicationStatus: "NOT_PUBLISHED", reviewQueue: undefined }), row({ reelId: "published", editorialStatus: "APPROVED", publicationStatus: "PUBLISHED", reviewQueue: undefined })];
  const counts = queueCounts(rows);
  assert.equal(counts.PENDING, 1);
  assert.equal(counts.CONTENT_READY, 1);
  assert.equal(counts.APPROVED, 2);
  assert.equal(counts.PUBLISHED, 1);
  assert.equal(counts.FAST_PATH, 1);
  assert.equal(queueMatches(rows[1], "CONTENT_READY"), true);
  assert.equal(queueMatches(rows[0], "STANDARD_REVIEW"), false);
});

test("save and next selects the next unpublished row in queue order", () => {
  const rows = [row({ reelId: "current" }), row({ reelId: "next" }), row({ reelId: "published", publicationStatus: "PUBLISHED" }), row({ reelId: "later" })];
  assert.equal(nextReviewRow(rows, "current")?.reelId, "next");
  assert.equal(nextReviewRow(rows, "next")?.reelId, "later");
  assert.equal(nextReviewRow(rows, "later")?.reelId, "current");
  assert.equal(nextReviewRow([row({ reelId: "current" })], "current"), null);
});

test("admin authorization separates read and governance mutation roles", () => {
  assert.equal(canReadWorkspace("VIEWER"), true);
  assert.equal(canMutateGovernance("VIEWER"), false);
  assert.equal(canMutateGovernance("REVIEWER"), true);
  assert.throws(() => requireRole(null, ["ADMIN", "REVIEWER"]), /ADMIN_AUTH_REQUIRED/);
  assert.throws(() => requireRole({ userId: "u", email: null, role: "VIEWER" }, ["ADMIN"]), /ADMIN_FORBIDDEN/);
});

test("admin route contract covers every protected workspace surface", () => {
  assert.deepEqual(PROTECTED_ADMIN_ROUTES, ["/admin", "/admin/review", "/admin/analytics", "/admin/publications"]);
  assert.deepEqual(requiredRolesForPath("/admin/review"), ["ADMIN", "REVIEWER", "VIEWER"]);
  assert.deepEqual(requiredRolesForPath("/public"), []);
});
