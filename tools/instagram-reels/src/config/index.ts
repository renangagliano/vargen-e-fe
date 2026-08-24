import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type MediaConfig = {
  repoRoot: string;
  toolRoot: string;
  mediaRoot: string | null;
  reelsOutputRoot: string | null;
  pipelineStateRoot: string;
  mediaRootConfigured: boolean;
  reelsOutputRootConfigured: boolean;
  pipelineStateRootConfigured: boolean;
  ffmpegBin: string | null;
  ffprobeBin: string | null;
  reelSafeZoneTopPx: number;
  reelSafeZoneBottomPx: number;
  reelSafeZoneSidePx: number;
};

function configuredPath(value: string | undefined, fallback: string): { value: string; configured: boolean } {
  const trimmed = value?.trim();
  return trimmed
    ? { value: path.resolve(trimmed), configured: true }
    : { value: fallback, configured: false };
}

function loadLocalEnvironment(env: NodeJS.ProcessEnv, repoRoot: string): NodeJS.ProcessEnv {
  if (env !== process.env) return env;
  const localEnvPath = path.join(repoRoot, ".env.local");
  if (!fs.existsSync(localEnvPath)) return env;
  const merged = { ...env };
  for (const line of fs.readFileSync(localEnvPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (merged[key] === undefined) merged[key] = value;
  }
  return merged;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, repoRoot = process.cwd()): MediaConfig {
  const normalizedRepoRoot = path.resolve(repoRoot);
  const effectiveEnv = loadLocalEnvironment(env, normalizedRepoRoot);
  const toolRoot = path.join(normalizedRepoRoot, "tools", "instagram-reels");
  const output = effectiveEnv.VARGEN_REELS_OUTPUT_ROOT?.trim()
    ? { value: path.resolve(effectiveEnv.VARGEN_REELS_OUTPUT_ROOT.trim()), configured: true }
    : { value: null, configured: false };
  const state = configuredPath(effectiveEnv.VARGEN_PIPELINE_STATE_ROOT, path.join(os.tmpdir(), "vargen-e-fe-pipeline-state"));
  const media = effectiveEnv.VARGEN_MEDIA_ROOT?.trim();
  const numeric = (key: string, fallback: number): number => {
    const value = Number(effectiveEnv[key]);
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
  };

  return {
    repoRoot: normalizedRepoRoot,
    toolRoot,
    mediaRoot: media ? path.resolve(media) : null,
    reelsOutputRoot: output.value,
    pipelineStateRoot: state.value,
    mediaRootConfigured: Boolean(media),
    reelsOutputRootConfigured: output.configured,
    pipelineStateRootConfigured: state.configured,
    ffmpegBin: effectiveEnv.FFMPEG_BIN?.trim() || null,
    ffprobeBin: effectiveEnv.FFPROBE_BIN?.trim() || null,
    reelSafeZoneTopPx: numeric("REEL_SAFE_ZONE_TOP_PX", 120),
    reelSafeZoneBottomPx: numeric("REEL_SAFE_ZONE_BOTTOM_PX", 300),
    reelSafeZoneSidePx: numeric("REEL_SAFE_ZONE_SIDE_PX", 80),
  };
}

export function databasePath(config: MediaConfig): string {
  return path.join(config.pipelineStateRoot, "media-catalog.sqlite");
}
