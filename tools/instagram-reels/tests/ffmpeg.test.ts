import assert from "node:assert/strict";
import test from "node:test";
import { detectMediaTools } from "../src/ffmpeg/detection.js";

test("detects FFmpeg/FFprobe without shell interpolation", async (t) => {
  const tools = await detectMediaTools({ ...process.env });
  if (!tools.ffmpeg.installed || !tools.ffprobe.installed) {
    t.skip("FFmpeg/FFprobe are not installed in this environment");
    return;
  }
  assert.ok(tools.ffmpeg.version);
  assert.ok(tools.ffprobe.version);
});
