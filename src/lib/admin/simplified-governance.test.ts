import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isBibleReferenceStructurallyValid } from "../../../packages/admin-shared/src/admin/mutation-contract.ts";
import { resolveEffectiveBibleStatus, resolveEffectiveRightsStatus } from "../../../packages/admin-shared/src/admin/governance-state.ts";

const sql = readFileSync("docs/instagram/014_fix_governance_effective_state.sql", "utf8");
const bibleSaveMigration = readFileSync("docs/instagram/015_fix_bible_reference_save_pipeline.sql", "utf8");
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

test("approval changes review state on the current version without creating an editorial version", () => {
  const approvalBranch = sql.slice(sql.indexOf("if p_action = 'approve_editorial'"));
  assert.doesNotMatch(approvalBranch, /insert into editorial_versions/);
  assert.match(approvalBranch, /update editorial_versions set review_status/);
  assert.match(approvalBranch, /where reel_id = p_reel_id and editorial_version = v_current/);
});

test("the Admin runtime banner and mutation gate use one server resolver", () => {
  const page = readFileSync("apps/admin/app/review/page.tsx", "utf8");
  const route = readFileSync("apps/admin/app/api/admin/mutations/route.ts", "utf8");
  assert.match(page, /getAdminRuntimeConfig/);
  assert.match(page, /isOperationalAdminMode/);
  assert.match(route, /getAdminRuntimeConfig/);
  assert.match(route, /assertRemoteMutationEnabled\(runtimeConfig\)/);
});

test("login does not claim that every production workspace is read-only", () => {
  const login = readFileSync("apps/admin/app/login/page.tsx", "utf8");
  assert.doesNotMatch(login, /opera em modo somente leitura/);
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

test("the Bible save migration uses a valid canonical SQL grammar and preserves the new-version workflow", () => {
  assert.match(bibleSaveMigration, /create or replace function public\.is_valid_bible_reference/);
  assert.match(bibleSaveMigration, /not public\.is_valid_bible_reference\(v_reference\)/);
  assert.match(bibleSaveMigration, /editorial_version = v_next/);
  assert.match(bibleSaveMigration, /BIBLE_VERIFIED/);
  assert.match(bibleSaveMigration, /bible-evidence:/);
  assert.match(bibleSaveMigration, /bible-verification:/);
  assert.match(bibleSaveMigration, /EDITORIAL_SAVED/);
  assert.doesNotMatch(bibleSaveMigration, /DROP TABLE|RIGHTS_NOTE_REQUIRED|BIBLE_NOTE_REQUIRED/);
});

test("the canonical Bible examples remain accepted by the application validator", () => {
  for (const reference of [
    "Isaías 35:1-2",
    "Colossenses 3:12-14",
    "João 20:8",
    "Lucas 4:19",
    "Êxodo 14",
    "Salmos 23:1-4",
    "1 Coríntios 13:4-7",
    "2 Timóteo 3:16-17",
  ]) assert.equal(isBibleReferenceStructurallyValid(reference), true, reference);
});
