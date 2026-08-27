import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { REMOTE_TABLE_MAPPING, remoteMigrationPlan } from "../src/cli/remote-migration.js";

test("remote migration plan maps governance state without media or secrets", () => {
  const plan = remoteMigrationPlan();
  assert.ok(plan.some((item) => item.source === "derived_reels" && item.target === "derived_reels"));
  assert.ok(plan.some((item) => item.source === "pilot_publications" && item.target === "publication_records"));
  assert.equal(Object.values(REMOTE_TABLE_MAPPING).some((target) => target.includes("media_bytes")), false);
  assert.equal(Object.values(REMOTE_TABLE_MAPPING).some((target) => target.includes("access_token")), false);
});

test("remote schema enables RLS and exposes no ordinary governance writes", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "docs/instagram/SUPABASE_SCHEMA_PROPOSAL.sql"), "utf8");
  assert.match(sql, /alter table public\.%I enable row level security/);
  assert.match(sql, /grant select on table public\.%I to authenticated/);
  assert.doesNotMatch(sql, /create policy[^\n]+for update/i);
  assert.match(sql, /create table if not exists public\.profiles/);
});
