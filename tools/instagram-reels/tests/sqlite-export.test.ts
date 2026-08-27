import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fixture } from "./review.test.js";
import { exportPath, exportSqliteGovernance } from "../src/admin/sqlite-export.js";
import { importSupabase } from "../src/admin/supabase-import.js";

test("SQLite governance export is deterministic in scope and import defaults to dry-run", async () => {
  const item = await fixture();
  const exported = exportSqliteGovernance(item.config);
  assert.equal(exported.manifest.secrets_exported, false);
  assert.equal(exported.manifest.media_bytes_exported, false);
  assert.equal((exported.manifest.table_counts as Record<string, number>).media_assets, 1);
  assert.equal((exported.manifest.stable_ids as Record<string, unknown[]>).media_assets.length, 1);
  assert.equal((exported.manifest.stable_ids as Record<string, unknown[]>).pilot_publications.length, 0);
  const dryRun = await importSupabase(item.config, { apply: false });
  assert.equal(dryRun.mode, "dry-run");
  assert.equal(dryRun.apply_performed, false);
  assert.equal(fs.existsSync(exportPath(item.config)), true);
});
