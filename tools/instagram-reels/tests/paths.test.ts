import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertFileInsideRoot, assertPathInside } from "../src/security/paths.js";

test("accepts Unicode, spaces and ampersands inside media root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vargen-paths-"));
  const file = path.join(root, "Vargen & Fé", "Á Estrela e o Rei.mp4");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, "fixture");
  await assertFileInsideRoot(root, file);
  assert.equal(await assertPathInside(root, file), file);
});

test("rejects traversal outside media root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vargen-traversal-"));
  await assert.rejects(() => assertPathInside(root, path.join(root, "..", "outside.mp4")), /PATH_OUTSIDE_MEDIA_ROOT/);
});
