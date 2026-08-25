export type InstagramPublishMode = "dry-run" | "approval" | "full-auto";

export type AutomationConfig = {
  publishMode: InstagramPublishMode;
  requireApproval: boolean;
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

export function loadAutomationConfig(env: NodeJS.ProcessEnv = process.env): AutomationConfig {
  const effectiveEnv = env === process.env ? loadLocalEnvironment(env) : env;
  const rawMode = effectiveEnv.INSTAGRAM_PUBLISH_MODE?.trim() as InstagramPublishMode | undefined;
  const publishMode: InstagramPublishMode = rawMode === "approval" || rawMode === "full-auto" ? rawMode : "dry-run";
  return {
    publishMode,
    requireApproval: effectiveEnv.INSTAGRAM_REQUIRE_APPROVAL !== "false",
    timezone: effectiveEnv.INSTAGRAM_TIMEZONE?.trim() || "America/Sao_Paulo",
    maxReelsPerDay: integer(effectiveEnv.MAX_REELS_PER_DAY, 1),
    minHoursBetweenReels: integer(effectiveEnv.MIN_HOURS_BETWEEN_REELS, 24),
    maxReelsPerSongPer30Days: integer(effectiveEnv.MAX_REELS_PER_SONG_PER_30_DAYS, 3),
    maxReelsPerCollectionConsecutively: integer(effectiveEnv.MAX_REELS_PER_COLLECTION_CONSECUTIVELY, 2),
  };
}

export function runtimeEnvironmentValue(key: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (env === process.env ? loadLocalEnvironment(env) : env)[key]?.trim() || undefined;
}

export function runtimeEnvironmentRawValue(key: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = (env === process.env ? loadLocalEnvironment(env) : env)[key];
  return value || undefined;
}

function loadLocalEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const filePath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(filePath)) return env;
  const merged = { ...env };
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (merged[key] !== undefined) continue;
    merged[key] = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return merged;
}
import fs from "node:fs";
import path from "node:path";
