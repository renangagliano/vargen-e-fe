import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("docs/instagram/012_simplify_governance_actions.sql", "utf8");
const ui = readFileSync("packages/admin-shared/src/ui/review-workspace.tsx", "utf8");
const repository = readFileSync("packages/admin-shared/src/admin/governance-repository.ts", "utf8");

test("simplified RPC contract removes note requirements and supports source upsert", () => {
  assert.doesNotMatch(sql, /BIBLE_NOTE_REQUIRED|RIGHTS_NOTE_REQUIRED|REVIEW_NOTE_REQUIRED/);
  assert.match(sql, /p_action not in \('save_editorial', 'confirm_rights', 'approve_editorial', 'needs_changes', 'reject'\)/);
  assert.match(sql, /rights-source:/);
  assert.match(sql, /BIBLE_VERIFIED/);
  assert.match(sql, /confirmation_statement/);
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
