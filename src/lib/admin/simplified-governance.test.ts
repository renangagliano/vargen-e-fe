import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveEffectiveBibleStatus, resolveEffectiveRightsStatus } from "../../../packages/admin-shared/src/admin/governance-state.ts";

const sql = readFileSync("docs/instagram/014_fix_governance_effective_state.sql", "utf8");
const ui = readFileSync("packages/admin-shared/src/ui/review-workspace.tsx", "utf8");
const repository = readFileSync("packages/admin-shared/src/admin/governance-repository.ts", "utf8");

test("simplified RPC contract removes note requirements and supports source upsert", () => {
  assert.doesNotMatch(sql, /BIBLE_NOTE_REQUIRED|RIGHTS_NOTE_REQUIRED|REVIEW_NOTE_REQUIRED/);
  assert.match(sql, /p_action not in \('save_editorial', 'confirm_rights', 'approve_editorial', 'needs_changes', 'reject'\)/);
  assert.match(sql, /rights-source:/);
  assert.match(sql, /BIBLE_VERIFIED/);
  assert.match(sql, /confirmation_statement/);
  assert.match(sql, /content-ready:remote:/);
  assert.match(sql, /content-ready:rights:/);
  assert.match(sql, /bible-verification:/);
});

test("review drawer uses the direct Bible-save workflow and overlay confirmations", () => {
  assert.doesNotMatch(ui, /Verificar Bíblia|verifyBible|actionNote/);
  assert.match(ui, /isBibleReferenceStructurallyValid/);
  assert.match(ui, /admin-action-dialog__card/);
  assert.match(ui, /confirmation_statement = RIGHTS_CONFIRMATION_STATEMENT/);
  assert.match(ui, /confirm_rejection = true/);
});

test("remote candidate detail reads current-version readiness and review evidence", () => {
  assert.match(repository, /content_ready_evaluations/);
  assert.match(repository, /editorial_version.*versionForQueries/);
  assert.match(repository, /human_reviews/);
});

test("effective Bible state requires matching current-version evidence and verification", () => {
  assert.equal(resolveEffectiveBibleStatus({ reference: "Colossenses 3:12-14", evidenceStatus: "VERIFIED", evidenceVersion: 2, verificationVersion: 2, editorialVersion: 2 }), "VERIFIED");
  assert.equal(resolveEffectiveBibleStatus({ reference: "Colossenses 3:12-14", evidenceStatus: "VERIFIED", evidenceVersion: 1, verificationVersion: 1, editorialVersion: 2 }), "REVIEW_REQUIRED");
  assert.equal(resolveEffectiveBibleStatus({ reference: "", editorialVersion: 2 }), "MISSING");
});

test("effective rights state is derived from confirmation, not source metadata", () => {
  assert.equal(resolveEffectiveRightsStatus({ sourceExists: true, confirmationStatuses: ["RIGHTS_CONFIRMED"] }), "RIGHTS_CONFIRMED");
  assert.equal(resolveEffectiveRightsStatus({ sourceExists: true, confirmationStatuses: [] }), "RIGHTS_PENDING_CONFIRMATION");
  assert.equal(resolveEffectiveRightsStatus({ sourceExists: false, confirmationStatuses: [] }), "MISSING");
});
