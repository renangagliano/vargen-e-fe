import assert from "node:assert/strict";
import test from "node:test";
import { canPublish, parseAdminPublicationRequest, publicationKey } from "../../../packages/admin-shared/src/admin/publication-contract.ts";

test("publication request requires explicit confirmation and stable request id", () => {
  assert.deepEqual(parseAdminPublicationRequest({ reel_id: "reel-abc123", expected_current_version: 2, request_id: "publication:req-1", confirmed: true }), { reel_id: "reel-abc123", expected_current_version: 2, request_id: "publication:req-1", confirmed: true });
  assert.throws(() => parseAdminPublicationRequest({ reel_id: "reel-abc123", expected_current_version: 2, request_id: "publication:req-1", confirmed: false }), /PUBLICATION_CONFIRMATION_REQUIRED/);
});

test("manual publication key is deterministic without secrets or URLs", () => {
  const input = { reelId: "reel-1", editorialVersion: 2, sourceChecksum: "abc", mediaPath: "reel.mp4", mediaSize: 10, targetAccount: "account-1" };
  assert.equal(publicationKey(input), publicationKey(input));
  assert.match(publicationKey(input), /^instagram:reel-1:2:[a-f0-9]+$/);
  assert.doesNotMatch(publicationKey(input), /token|https|secret/i);
});

test("only an enabled ADMIN with CONTENT_READY can publish", () => {
  assert.equal(canPublish("ADMIN", true, true, "NOT_PUBLISHED", false), true);
  assert.equal(canPublish("REVIEWER", true, true, "NOT_PUBLISHED", false), false);
  assert.equal(canPublish("ADMIN", false, true, "NOT_PUBLISHED", false), false);
  assert.equal(canPublish("ADMIN", true, false, "NOT_PUBLISHED", false), false);
  assert.equal(canPublish("ADMIN", true, true, "NOT_PUBLISHED", true), false);
});
