import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config/index.js";
import { ensureReelsStructure, REELS_SUBDIRECTORIES } from "../src/media/reels-structure.js";

test("creates Reels as a sibling of the immutable master directory", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "vargen-reels-"));
  const mediaRoot = path.join(parent, "Vargen Band", "Vargen & Fé - MP4");
  const reelsRoot = path.join(parent, "Vargen Band", "Reels");
  await fs.mkdir(mediaRoot, { recursive: true });
  const config = loadConfig({ ...process.env, VARGEN_MEDIA_ROOT: mediaRoot, VARGEN_REELS_OUTPUT_ROOT: reelsRoot, VARGEN_PIPELINE_STATE_ROOT: path.join(parent, "state") }, process.cwd());
  const created = await ensureReelsStructure(config);
  assert.equal(created.length, REELS_SUBDIRECTORIES.length + 1);
  for (const directory of created) assert.equal((await fs.stat(directory)).isDirectory(), true);
  assert.equal((await fs.readdir(mediaRoot)).length, 0);
});

test("rejects a Reels root inside the master directory", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "vargen-reels-invalid-"));
  const mediaRoot = path.join(parent, "Vargen Band", "Vargen & Fé - MP4");
  await fs.mkdir(mediaRoot, { recursive: true });
  const config = loadConfig({ ...process.env, VARGEN_MEDIA_ROOT: mediaRoot, VARGEN_REELS_OUTPUT_ROOT: path.join(mediaRoot, "Reels"), VARGEN_PIPELINE_STATE_ROOT: path.join(parent, "state") }, process.cwd());
  await assert.rejects(() => ensureReelsStructure(config), /REELS_ROOT_MUST_BE_SIBLING_OF_MEDIA_ROOT|DIRECTORY_SEPARATION_REQUIRED/);
});
