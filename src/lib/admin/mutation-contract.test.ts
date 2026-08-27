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
  RIGHTS_CONFIRMATION_STATEMENT,
  isBibleReferenceStructurallyValid,
  validateMutationActionPayload,
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

test("governance actions require only explicit rights/rejection confirmations", () => {
  const base = { reel_id: "reel-1", expected_current_version: 2, request_id: "request:action-1" };
  assert.throws(() => parseMutationRequest({ ...base, action: "unknown_action" }), /MUTATION_ACTION_INVALID/);
  assert.throws(() => parseMutationRequest({ ...base, action: "confirm_rights" }), /RIGHTS_CONFIRMATION_REQUIRED/);
  assert.doesNotThrow(() => parseMutationRequest({ ...base, action: "confirm_rights", confirmation_statement: RIGHTS_CONFIRMATION_STATEMENT }));
  assert.doesNotThrow(() => parseMutationRequest({ ...base, action: "approve_editorial" }));
  assert.doesNotThrow(() => parseMutationRequest({ ...base, action: "needs_changes" }));
  assert.throws(() => parseMutationRequest({ ...base, action: "reject" }), /REJECTION_CONFIRMATION_REQUIRED/);
  assert.doesNotThrow(() => parseMutationRequest({ ...base, action: "reject", confirm_rejection: true }));
});

test("editorial saves may retain an optional operator note without requiring it", () => {
  assert.doesNotThrow(() => validateMutationActionPayload({ action: "save_editorial", reel_id: "reel-1", expected_current_version: 1, request_id: "request:save" }));
  assert.doesNotThrow(() => validateMutationActionPayload({ action: "approve_editorial", reel_id: "reel-1", expected_current_version: 1, request_id: "request:approve" }));
});

test("Bible reference validation is syntax-only and fails closed for malformed input", () => {
  assert.equal(isBibleReferenceStructurallyValid("Lucas 19"), true);
  assert.equal(isBibleReferenceStructurallyValid("Colossenses 3:12-14"), true);
  assert.equal(isBibleReferenceStructurallyValid("João 3,16-17"), true);
  assert.equal(isBibleReferenceStructurallyValid(""), false);
  assert.equal(isBibleReferenceStructurallyValid("not a reference"), false);
  assert.throws(() => parseMutationRequest({ action: "save_editorial", reel_id: "reel-1", expected_current_version: 1, request_id: "request:bible", fields: { bible_reference: "not a reference" } }), /BIBLE_REFERENCE_INVALID/);
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
