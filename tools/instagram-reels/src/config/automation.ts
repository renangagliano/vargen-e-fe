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
  const rawMode = env.INSTAGRAM_PUBLISH_MODE?.trim() as InstagramPublishMode | undefined;
  const publishMode: InstagramPublishMode = rawMode === "approval" || rawMode === "full-auto" ? rawMode : "dry-run";
  return {
    publishMode,
    requireApproval: env.INSTAGRAM_REQUIRE_APPROVAL !== "false",
    timezone: env.INSTAGRAM_TIMEZONE?.trim() || "America/Sao_Paulo",
    maxReelsPerDay: integer(env.MAX_REELS_PER_DAY, 1),
    minHoursBetweenReels: integer(env.MIN_HOURS_BETWEEN_REELS, 24),
    maxReelsPerSongPer30Days: integer(env.MAX_REELS_PER_SONG_PER_30_DAYS, 3),
    maxReelsPerCollectionConsecutively: integer(env.MAX_REELS_PER_COLLECTION_CONSECUTIVELY, 2),
  };
}
