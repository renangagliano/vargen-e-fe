import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ReelCandidate } from "../shared/types.js";

const execFileAsync = promisify(execFile);
export const TEMPLATE_VERSION = "vertical-foreground-blur-v1";

function nullDevice(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

export function buildVerticalFilter(logoEnabled: boolean, safeZoneTopPx = 120, inputLabel = "[0:v]"): string {
  const logo = logoEnabled
    ? `;[1:v]format=rgba,scale=140:-1,colorchannelmixer=aa=0.78[logo];[comp][logo]overlay=(W-w)/2:${safeZoneTopPx}:format=auto,format=yuv420p[v]`
    : ";[comp]format=yuv420p[v]";
  return `${inputLabel}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:1,eq=brightness=-0.08[bg];${inputLabel}scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[comp]${logo}`;
}

export async function renderReel(input: {
  ffmpegPath: string;
  sourcePath: string;
  logoPath: string | null;
  candidate: ReelCandidate;
  outputPath: string;
  safeZoneTopPx?: number;
}): Promise<void> {
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  const temporaryPath = `${input.outputPath}.part-${process.pid}-${Date.now()}.mp4`;
  const args = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", input.sourcePath,
  ];
  if (input.logoPath) args.push("-loop", "1", "-i", input.logoPath);
  // Keep video/audio trimming and composition in one deterministic graph.
  const start = (input.candidate.startTimeMs / 1000).toFixed(3);
  const duration = (input.candidate.durationMs / 1000).toFixed(3);
  const composition = buildVerticalFilter(Boolean(input.logoPath), input.safeZoneTopPx ?? 120, "[trimmed]");
  args.push("-filter_complex", `[0:v]trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS[trimmed];${composition};[0:a]atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS[a]`);
  args.push(
    "-map", "[v]", "-map", "[a]", "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    "-t", (input.candidate.durationMs / 1000).toFixed(3), temporaryPath,
  );
  try {
    await execFileAsync(input.ffmpegPath, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    await fs.rename(temporaryPath, input.outputPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function makeThumbnail(ffmpegPath: string, sourceReelPath: string, outputPath: string, durationMs: number): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.part-${process.pid}-${Date.now()}.jpg`;
  await execFileAsync(ffmpegPath, [
    "-y", "-hide_banner", "-loglevel", "error", "-ss", Math.min(2, Math.max(0.1, durationMs / 2000)).toFixed(3),
    "-i", sourceReelPath, "-frames:v", "1", "-q:v", "2", temporaryPath,
  ], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 }).then(async () => {
    await fs.rename(temporaryPath, outputPath);
  }).catch(async (error) => {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  });
}

export function outputFilename(index: number, category: string): string {
  const suffix = category === "LYRICAL_HOOK" ? "hook" : category === "MAIN_CHORUS" ? "main-chorus" : category === "STORY_BUILD" ? "story-build" : category.toLowerCase().replace(/_/g, "-");
  return `reel-${String(index).padStart(2, "0")}-${suffix}`;
}

export { nullDevice };
