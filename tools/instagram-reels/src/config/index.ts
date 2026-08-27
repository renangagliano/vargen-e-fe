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
  minReelCandidateScore: number;
  minReelConfidence: number;
  maxReelsPerSource: number;
  maxCandidateOverlapPercent: number;
  analysisVersion: string;
  catalogRenderVersion: string;
  editorialVersion: string;
  reviewerName: string | null;
  reviewHost: string;
  reviewPort: number;
  azureStorageAccountName: string | null;
  azureStorageContainerName: string;
  azureStorageSasTtlMinutes: number;
  azureStorageBlobPrefix: string;
  azureStorageEndpointSuffix: string;
  microsoftPersonalClientId: string | null;
  microsoftPersonalAuthority: string;
  microsoftPersonalRedirectUri: string;
  microsoftPersonalScopes: string[];
  microsoftPersonalAuthCacheRoot: string;
};

export type ProjectEnvironmentSource = "process.env" | ".env.local" | "default";

type ProjectEnvironmentDetails = {
  values: NodeJS.ProcessEnv;
  sources: Map<string, Exclude<ProjectEnvironmentSource, "default">>;
  localKeyCounts: Map<string, number>;
};

function configuredPath(value: string | undefined, fallback: string): { value: string; configured: boolean } {
  const trimmed = value?.trim();
  return trimmed
    ? { value: path.resolve(trimmed), configured: true }
    : { value: fallback, configured: false };
}

function readProjectEnvironmentDetails(env: NodeJS.ProcessEnv, repoRoot: string): ProjectEnvironmentDetails {
  const sources = new Map<string, Exclude<ProjectEnvironmentSource, "default">>();
  for (const [key, value] of Object.entries(env)) if (value !== undefined) sources.set(key, "process.env");
  const localKeyCounts = new Map<string, number>();
  const localEnvPath = path.join(repoRoot, ".env.local");
  const merged = { ...env };
  if (!fs.existsSync(localEnvPath)) return { values: merged, sources, localKeyCounts };
  const localValues = new Map<string, string>();
  for (const line of fs.readFileSync(localEnvPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    localValues.set(key, value);
    localKeyCounts.set(key, (localKeyCounts.get(key) ?? 0) + 1);
  }
  for (const [key, value] of localValues) {
    if (merged[key] === undefined) {
      merged[key] = value;
      sources.set(key, ".env.local");
    }
  }
  return { values: merged, sources, localKeyCounts };
}

export function loadProjectEnvironment(env: NodeJS.ProcessEnv = process.env, repoRoot = process.cwd()): NodeJS.ProcessEnv {
  return readProjectEnvironmentDetails(env, path.resolve(repoRoot)).values;
}

export function projectEnvironmentSource(key: string, env: NodeJS.ProcessEnv = process.env, repoRoot = process.cwd()): ProjectEnvironmentSource {
  return readProjectEnvironmentDetails(env, path.resolve(repoRoot)).sources.get(key) ?? "default";
}

export function projectEnvironmentLocalKeyCount(key: string, repoRoot = process.cwd()): number {
  return readProjectEnvironmentDetails(Object.create(null) as NodeJS.ProcessEnv, path.resolve(repoRoot)).localKeyCounts.get(key) ?? 0;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, repoRoot = process.cwd()): MediaConfig {
  const normalizedRepoRoot = path.resolve(repoRoot);
  const effectiveEnv = loadProjectEnvironment(env, normalizedRepoRoot);
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

  const confidence = Number(effectiveEnv.MIN_REEL_CONFIDENCE ?? "0.65");
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
    minReelCandidateScore: numeric("MIN_REEL_CANDIDATE_SCORE", 65),
    minReelConfidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.65,
    maxReelsPerSource: Number.isFinite(Number(effectiveEnv.MAX_REELS_PER_SOURCE)) ? Math.max(0, Math.round(Number(effectiveEnv.MAX_REELS_PER_SOURCE))) : 3,
    maxCandidateOverlapPercent: Math.min(100, Math.max(0, numeric("MAX_CANDIDATE_OVERLAP_PERCENT", 50))),
    analysisVersion: effectiveEnv.VARGEN_ANALYSIS_VERSION?.trim() || "phase6-audio-heuristic-v1",
    catalogRenderVersion: effectiveEnv.VARGEN_CATALOG_RENDER_VERSION?.trim() || "phase6-catalog-render-v1",
    editorialVersion: effectiveEnv.VARGEN_CATALOG_EDITORIAL_VERSION?.trim() || "phase6-editorial-v1",
    reviewerName: effectiveEnv.VARGEN_REVIEWER_NAME?.trim() || null,
    reviewHost: effectiveEnv.VARGEN_REVIEW_HOST?.trim() || "127.0.0.1",
    reviewPort: numeric("VARGEN_REVIEW_PORT", 4177),
    azureStorageAccountName: effectiveEnv.AZURE_STORAGE_ACCOUNT_NAME?.trim() || null,
    azureStorageContainerName: effectiveEnv.AZURE_STORAGE_CONTAINER_NAME?.trim() || "instagram-publish-temp",
    azureStorageSasTtlMinutes: numeric("AZURE_STORAGE_SAS_TTL_MINUTES", 60),
    azureStorageBlobPrefix: effectiveEnv.AZURE_STORAGE_BLOB_PREFIX?.trim() || "instagram-pilot",
    azureStorageEndpointSuffix: effectiveEnv.AZURE_STORAGE_ENDPOINT_SUFFIX?.trim() || "core.windows.net",
    microsoftPersonalClientId: effectiveEnv.MICROSOFT_PERSONAL_CLIENT_ID?.trim() || null,
    microsoftPersonalAuthority: effectiveEnv.MICROSOFT_PERSONAL_AUTHORITY?.trim() || "https://login.microsoftonline.com/consumers",
    microsoftPersonalRedirectUri: effectiveEnv.MICROSOFT_PERSONAL_REDIRECT_URI?.trim() || "http://localhost",
    microsoftPersonalScopes: (effectiveEnv.MICROSOFT_PERSONAL_SCOPES?.trim() || "Files.ReadWrite").split(/[\s,]+/).filter(Boolean),
    microsoftPersonalAuthCacheRoot: path.join(state.value, "auth"),
  };
}

export function databasePath(config: MediaConfig): string {
  return path.join(config.pipelineStateRoot, "media-catalog.sqlite");
}
