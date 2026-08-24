import assert from "node:assert/strict";
import test from "node:test";
import { loadAutomationConfig } from "../src/config/automation.js";

test("defaults automation to dry-run with conservative controls", () => {
  const config = loadAutomationConfig({ ...process.env, INSTAGRAM_PUBLISH_MODE: undefined, INSTAGRAM_REQUIRE_APPROVAL: undefined });
  assert.equal(config.publishMode, "dry-run");
  assert.equal(config.requireApproval, true);
  assert.equal(config.timezone, "America/Sao_Paulo");
  assert.equal(config.maxReelsPerDay, 1);
});

test("supports future approval and full-auto modes as configuration only", () => {
  assert.equal(loadAutomationConfig({ ...process.env, INSTAGRAM_PUBLISH_MODE: "approval" }).publishMode, "approval");
  assert.equal(loadAutomationConfig({ ...process.env, INSTAGRAM_PUBLISH_MODE: "full-auto" }).publishMode, "full-auto");
});
