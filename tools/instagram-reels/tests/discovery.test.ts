import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverMedia } from "../src/media/discovery.js";

test("recursively discovers supported video extensions without following unsupported files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vargen-discovery-"));
  await fs.mkdir(path.join(root, "Vargen & Fé", "Coleção Águas"), { recursive: true });
  for (const name of ["A.mp4", "B.MOV", "C.m4v", "D.webm"]) await fs.writeFile(path.join(root, "Vargen & Fé", "Coleção Águas", name), "fixture");
  await fs.writeFile(path.join(root, "ignore.txt"), "ignore");
  const result = await discoverMedia(root);
  assert.equal(result.files.length, 4);
  assert.deepEqual(result.files.map((file) => file.extension).sort(), ["m4v", "mov", "mp4", "webm"]);
  assert.equal(result.errors.length, 0);
  assert.ok(result.directoriesVisited >= 3);
});
