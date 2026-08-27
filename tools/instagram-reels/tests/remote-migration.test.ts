import assert from "node:assert/strict";
import test from "node:test";
import { REMOTE_TABLE_MAPPING, remoteMigrationPlan } from "../src/cli/remote-migration.js";

test("remote migration plan maps governance state without media or secrets", () => {
  const plan = remoteMigrationPlan();
  assert.ok(plan.some((item) => item.source === "derived_reels" && item.target === "review_reels"));
  assert.ok(plan.some((item) => item.source === "pilot_publications" && item.target === "publication_records"));
  assert.equal(Object.values(REMOTE_TABLE_MAPPING).some((target) => target.includes("media_bytes")), false);
  assert.equal(Object.values(REMOTE_TABLE_MAPPING).some((target) => target.includes("access_token")), false);
});
