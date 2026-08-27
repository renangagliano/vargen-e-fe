import { loadProjectEnvironment } from "./index.js";

export type InstagramPublishMode = "dry-run" | "approval";

export type AutomationConfig = {
  publishMode: InstagramPublishMode;
  requireApproval: boolean;
  realPilotEnabled: boolean;
  autoPublishOnApproval: boolean;
  timezone: string;
  maxReelsPerDay: number;
  minHoursBetweenReels: number;
  maxReelsPerSongPer30Days: number;
  maxReelsPerCollectionConsecutively: number;
};

function integer(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function resolveInstagramPublishMode(value: string | undefined): InstagramPublishMode {
  const normalized = value?.trim();
  if (!normalized || normalized === "dry-run") return "dry-run";
  if (normalized === "approval") return "approval";
  throw new Error("INSTAGRAM_PUBLISH_MODE_INVALID");
}

export function resolveRequireApproval(value: string | undefined): boolean {
  const normalized = value?.trim();
  if (!normalized || normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("INSTAGRAM_REQUIRE_APPROVAL_INVALID");
}

export function resolveRealPilotEnabled(value: string | undefined): boolean {
  const normalized = value?.trim();
  if (!normalized || normalized === "false") return false;
  if (normalized === "true") return true;
  throw new Error("INSTAGRAM_PILOT_REAL_INVALID");
}

export function resolveAutoPublishOnApproval(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "false") return false;
  if (normalized === "true") return true;
  throw new Error("INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL_INVALID");
}

export function isPublicationApprovalConfigurationValid(config: Pick<AutomationConfig, "publishMode" | "requireApproval">): boolean {
  return config.publishMode !== "approval" || config.requireApproval;
}

export function isRealPilotEnvironmentReady(config: Pick<AutomationConfig, "publishMode" | "requireApproval" | "realPilotEnabled">): boolean {
  return config.realPilotEnabled && config.publishMode === "approval" && config.requireApproval;
}

export function loadAutomationConfig(env: NodeJS.ProcessEnv = process.env, repoRoot = process.cwd()): AutomationConfig {
  const effectiveEnv = loadProjectEnvironment(env, repoRoot);
  const publishMode = resolveInstagramPublishMode(effectiveEnv.INSTAGRAM_PUBLISH_MODE);
  return {
    publishMode,
    requireApproval: resolveRequireApproval(effectiveEnv.INSTAGRAM_REQUIRE_APPROVAL),
    realPilotEnabled: resolveRealPilotEnabled(effectiveEnv.INSTAGRAM_PILOT_REAL),
    autoPublishOnApproval: resolveAutoPublishOnApproval(effectiveEnv.INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL),
    timezone: effectiveEnv.INSTAGRAM_TIMEZONE?.trim() || "America/Sao_Paulo",
    maxReelsPerDay: integer(effectiveEnv.MAX_REELS_PER_DAY, 1),
    minHoursBetweenReels: integer(effectiveEnv.MIN_HOURS_BETWEEN_REELS, 24),
    maxReelsPerSongPer30Days: integer(effectiveEnv.MAX_REELS_PER_SONG_PER_30_DAYS, 3),
    maxReelsPerCollectionConsecutively: integer(effectiveEnv.MAX_REELS_PER_COLLECTION_CONSECUTIVELY, 2),
  };
}

export function runtimeEnvironmentValue(key: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return loadProjectEnvironment(env)[key]?.trim() || undefined;
}

export function runtimeEnvironmentRawValue(key: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = loadProjectEnvironment(env)[key];
  return value || undefined;
}
