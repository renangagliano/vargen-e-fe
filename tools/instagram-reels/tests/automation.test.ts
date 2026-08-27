import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { isPublicationApprovalConfigurationValid, isRealPilotEnvironmentReady, loadAutomationConfig, resolveAutoPublishOnApproval, resolveInstagramPublishMode, resolveRealPilotEnabled, resolveRequireApproval } from "../src/config/automation.js";

test("defaults automation to dry-run with conservative controls", () => {
  const config = loadAutomationConfig({ ...process.env, INSTAGRAM_PUBLISH_MODE: undefined, INSTAGRAM_REQUIRE_APPROVAL: undefined }, path.join(process.cwd(), "tools"));
  assert.equal(config.publishMode, "dry-run");
  assert.equal(config.requireApproval, true);
  assert.equal(config.timezone, "America/Sao_Paulo");
  assert.equal(config.maxReelsPerDay, 1);
});

test("supports approval mode and rejects unsupported modes", () => {
  assert.equal(loadAutomationConfig({ ...process.env, INSTAGRAM_PUBLISH_MODE: "approval" }).publishMode, "approval");
  assert.throws(() => resolveInstagramPublishMode("full-auto"), /INSTAGRAM_PUBLISH_MODE_INVALID/);
});

test("canonical publication mode resolution preserves configured values and defaults safely", () => {
  assert.equal(resolveInstagramPublishMode(undefined), "dry-run");
  assert.equal(resolveInstagramPublishMode(""), "dry-run");
  assert.equal(resolveInstagramPublishMode("dry-run"), "dry-run");
  assert.equal(resolveInstagramPublishMode("approval"), "approval");
  assert.throws(() => resolveInstagramPublishMode("unexpected"), /INSTAGRAM_PUBLISH_MODE_INVALID/);
});

test("process environment overrides local configuration through the shared loader", () => {
  assert.equal(loadAutomationConfig({ ...process.env, INSTAGRAM_PUBLISH_MODE: "approval" }, process.cwd()).publishMode, "approval");
  assert.equal(loadAutomationConfig({ ...process.env, INSTAGRAM_PUBLISH_MODE: "dry-run" }, process.cwd()).publishMode, "dry-run");
});

test(".env.local values are loaded when process values are absent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vargen-env-resolution-"));
  const emptyEnv = Object.create(null) as NodeJS.ProcessEnv;
  try {
    await fs.writeFile(path.join(root, ".env.local"), "INSTAGRAM_PUBLISH_MODE=dry-run\nINSTAGRAM_REQUIRE_APPROVAL=true\n", "utf8");
    assert.equal(loadAutomationConfig(emptyEnv, root).publishMode, "dry-run");
    await fs.writeFile(path.join(root, ".env.local"), "INSTAGRAM_PUBLISH_MODE=approval\nINSTAGRAM_REQUIRE_APPROVAL=true\n", "utf8");
    assert.equal(loadAutomationConfig(emptyEnv, root).publishMode, "approval");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("approval requires the approval flag and explicit false blocks publication", () => {
  assert.equal(resolveRequireApproval(undefined), true);
  assert.equal(resolveRequireApproval("true"), true);
  assert.equal(resolveRequireApproval("false"), false);
  assert.throws(() => resolveRequireApproval("maybe"), /INSTAGRAM_REQUIRE_APPROVAL_INVALID/);
  assert.equal(isPublicationApprovalConfigurationValid({ publishMode: "approval", requireApproval: true }), true);
  assert.equal(isPublicationApprovalConfigurationValid({ publishMode: "approval", requireApproval: false }), false);
});

test("real pilot environment is explicit, strict and approval-gated", () => {
  assert.equal(resolveRealPilotEnabled(undefined), false);
  assert.equal(resolveRealPilotEnabled("false"), false);
  assert.equal(resolveRealPilotEnabled("true"), true);
  assert.throws(() => resolveRealPilotEnabled("yes"), /INSTAGRAM_PILOT_REAL_INVALID/);
  assert.equal(isRealPilotEnvironmentReady({ realPilotEnabled: false, publishMode: "approval", requireApproval: true }), false);
  assert.equal(isRealPilotEnvironmentReady({ realPilotEnabled: true, publishMode: "dry-run", requireApproval: true }), false);
  assert.equal(isRealPilotEnvironmentReady({ realPilotEnabled: true, publishMode: "approval", requireApproval: false }), false);
  assert.equal(isRealPilotEnvironmentReady({ realPilotEnabled: true, publishMode: "approval", requireApproval: true }), true);
});

test("auto publication on approval is opt-in and strictly boolean", () => {
  assert.equal(resolveAutoPublishOnApproval(undefined), false);
  assert.equal(resolveAutoPublishOnApproval("false"), false);
  assert.equal(resolveAutoPublishOnApproval("true"), true);
  assert.throws(() => resolveAutoPublishOnApproval("enabled"), /INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL_INVALID/);
  assert.equal(loadAutomationConfig({ ...process.env, INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL: "true" }).autoPublishOnApproval, true);
});
