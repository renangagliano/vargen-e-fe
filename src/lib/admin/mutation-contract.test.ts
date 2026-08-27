import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTO_PUBLISH_CONFIRMATION,
  approvalProducesPublicationAuthorization,
  assertPublicationConfirmation,
  assertRemoteMutationEnabled,
  isMutationRoleAllowed,
  parseMutationRequest,
  resolveAutoPublishOnApproval,
} from "../../../packages/admin-shared/src/admin/mutation-contract.ts";

test("remote governance writes require the explicit Supabase writable mode", () => {
  assert.throws(() => assertRemoteMutationEnabled({ ADMIN_DATA_SOURCE: "supabase-readonly", ADMIN_REMOTE_WRITE_ENABLED: "false" }), /REMOTE_WRITE_DISABLED/);
  assert.doesNotThrow(() => assertRemoteMutationEnabled({ ADMIN_DATA_SOURCE: "supabase", ADMIN_REMOTE_WRITE_ENABLED: "true" }));
});

test("remote write roles fail closed", () => {
  assert.equal(isMutationRoleAllowed("save_editorial", "REVIEWER"), true);
  assert.equal(isMutationRoleAllowed("approve_editorial", "REVIEWER"), false);
  assert.equal(isMutationRoleAllowed("save_editorial", "VIEWER"), false);
});

test("mutation payload requires optimistic concurrency and a safe request id", () => {
  const request = parseMutationRequest({ action: "save_editorial", reel_id: "reel-1", expected_current_version: 2, request_id: "request:1", fields: { primary_pillar: "Fé" } });
  assert.equal(request.expected_current_version, 2);
  assert.throws(() => parseMutationRequest({ action: "save_editorial", reel_id: "reel-1", expected_current_version: 1, request_id: "unsafe id" }), /MUTATION_REQUEST_ID_INVALID/);
  assert.throws(() => parseMutationRequest({ action: "save_editorial", reel_id: "reel-1", expected_current_version: 0, request_id: "request:1" }), /EDITORIAL_VERSION_REQUIRED/);
});

test("auto publication is disabled by default and requires every explicit gate", () => {
  assert.equal(resolveAutoPublishOnApproval(undefined), false);
  assert.throws(() => resolveAutoPublishOnApproval("yes"), /INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL_INVALID/);
  const base = { autoPublishOnApproval: true, publishMode: "approval" as const, requireApproval: true, realPilotEnabled: true, contentReady: true, role: "ADMIN" as const };
  assert.equal(approvalProducesPublicationAuthorization(base), false);
  assert.equal(approvalProducesPublicationAuthorization({ ...base, confirmation: AUTO_PUBLISH_CONFIRMATION }), true);
  assert.equal(approvalProducesPublicationAuthorization({ ...base, role: "REVIEWER", confirmation: AUTO_PUBLISH_CONFIRMATION }), false);
  assert.throws(() => assertPublicationConfirmation("I_CONFIRM_ONE_REEL_PUBLICATION"), /PUBLICATION_CONFIRMATION_REQUIRED/);
});

