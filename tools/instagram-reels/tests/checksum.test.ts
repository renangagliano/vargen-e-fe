import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256File, stableAssetId } from "../src/media/checksum.js";

test("hashes media with streaming SHA-256 and remains stable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vargen-checksum-"));
  const file = path.join(directory, "source.mp4");
  await fs.writeFile(file, Buffer.alloc(1024 * 1024, 7));
  const first = await sha256File(file);
  const second = await sha256File(file);
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(stableAssetId(first), `asset-${first.slice(0, 24)}`);
  await fs.appendFile(file, "changed");
  assert.notEqual(first, await sha256File(file));
});
