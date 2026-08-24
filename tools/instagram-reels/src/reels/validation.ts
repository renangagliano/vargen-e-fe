import fs from "node:fs/promises";
import path from "node:path";
import type { MediaConfig } from "../config/index.js";
import { probeMedia } from "../ffmpeg/ffprobe.js";
import { assertDirectoryOutside } from "../security/paths.js";
import type { MediaMetadata, ReelCandidate } from "../shared/types.js";

export type ReelValidation = {
  status: "PASS" | "FAIL";
  reasons: string[];
  metadata: MediaMetadata | null;
  fileSize: number | null;
};

export async function validateReel(input: {
  config: MediaConfig;
  ffprobePath: string;
  sourcePath: string;
  outputPath: string;
  candidate: ReelCandidate;
}): Promise<ReelValidation> {
  const reasons: string[] = [];
  let metadata: MediaMetadata | null = null;
  let fileSize: number | null = null;
  try {
    const stats = await fs.stat(input.outputPath);
    fileSize = stats.size;
    if (stats.size <= 0) reasons.push("OUTPUT_FILE_EMPTY");
    if (path.resolve(input.sourcePath).toLowerCase() === path.resolve(input.outputPath).toLowerCase()) reasons.push("SOURCE_OUTPUT_SAME_PATH");
    if (input.config.mediaRoot && input.config.reelsOutputRoot) await assertDirectoryOutside(input.config.mediaRoot, input.config.reelsOutputRoot);
    metadata = await probeMedia(input.ffprobePath, input.outputPath);
    if (metadata.durationMs === null || Math.abs(metadata.durationMs - input.candidate.durationMs) > 1500) reasons.push("DURATION_OUT_OF_RANGE");
    if (metadata.width !== 1080 || metadata.height !== 1920) reasons.push("INVALID_VERTICAL_RESOLUTION");
    if (!metadata.videoCodec || metadata.videoCodec.toLowerCase() !== "h264") reasons.push("VIDEO_CODEC_NOT_H264");
    if (!metadata.audioCodec || metadata.audioCodec.toLowerCase() !== "aac") reasons.push("AUDIO_CODEC_NOT_AAC");
    if (metadata.audioCodec === null) reasons.push("AUDIO_MISSING");
    if (metadata.frameRate !== null && Math.abs(metadata.frameRate - 30) > 0.5) reasons.push("FPS_NOT_30");
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
  }
  return { status: reasons.length === 0 ? "PASS" : "FAIL", reasons, metadata, fileSize };
}
