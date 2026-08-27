import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config/index.js";
import { detectMediaTools } from "../src/ffmpeg/detection.js";

test("detects FFmpeg/FFprobe without shell interpolation", async (t) => {
  const config = loadConfig();
  const tools = await detectMediaTools({ ...process.env, FFMPEG_BIN: config.ffmpegBin ?? process.env.FFMPEG_BIN, FFPROBE_BIN: config.ffprobeBin ?? process.env.FFPROBE_BIN });
  if (!tools.ffmpeg.installed || !tools.ffprobe.installed) {
    t.skip("FFmpeg/FFprobe are not installed in this environment");
    return;
  }
  assert.ok(tools.ffmpeg.version);
  assert.ok(tools.ffprobe.version);
});
