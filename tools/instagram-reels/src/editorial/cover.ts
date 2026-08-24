import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { probeMedia } from "../ffmpeg/ffprobe.js";

const execFileAsync = promisify(execFile);

function escapeDrawtext(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/%/g, "\\%");
}

function escapeFilterPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/:/g, "\\:");
}

export function buildCoverFilter(input: { coverText: string; fontPath?: string | null; safeZoneTopPx?: number; safeZoneBottomPx?: number; safeZoneSidePx?: number }): string {
  const top = input.safeZoneTopPx ?? 120;
  const bottom = input.safeZoneBottomPx ?? 300;
  const side = input.safeZoneSidePx ?? 80;
  const y = Math.max(top + 80, 1920 - bottom - 190);
  const font = input.fontPath ? `fontfile='${escapeFilterPath(input.fontPath)}':` : "";
  return `drawbox=x=${side}:y=${y - 36}:w=${1080 - side * 2}:h=150:color=black@0.58:t=fill,drawtext=${font}text='${escapeDrawtext(input.coverText)}':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=${y}:shadowcolor=black@0.9:shadowx=2:shadowy=2`;
}

export async function generateCover(input: { ffmpegPath: string; ffprobePath: string; sourceReelPath: string; outputPath: string; coverText: string; durationMs: number; fontPath?: string | null; safeZoneTopPx?: number; safeZoneBottomPx?: number; safeZoneSidePx?: number }): Promise<{ width: number; height: number; fileSize: number }> {
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  const temporaryPath = `${input.outputPath}.part-${process.pid}-${Date.now()}.jpg`;
  const seekSeconds = Math.min(Math.max(input.durationMs / 4000, 0.5), 5);
  try {
    await execFileAsync(input.ffmpegPath, [
      "-y", "-hide_banner", "-loglevel", "error", "-ss", seekSeconds.toFixed(3), "-i", input.sourceReelPath,
      "-frames:v", "1", "-vf", buildCoverFilter(input), "-q:v", "2", temporaryPath,
    ], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    const metadata = await probeMedia(input.ffprobePath, temporaryPath);
    if (metadata.width !== 1080 || metadata.height !== 1920) throw new Error("COVER_INVALID_RESOLUTION");
    const stats = await fs.stat(temporaryPath);
    if (stats.size <= 0) throw new Error("COVER_FILE_EMPTY");
    await fs.rename(temporaryPath, input.outputPath);
    return { width: metadata.width, height: metadata.height, fileSize: stats.size };
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
