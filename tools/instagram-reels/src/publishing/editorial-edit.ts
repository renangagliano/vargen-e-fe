import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, type MediaConfig } from "../config/index.js";
import { derivedReelById, latestEditorialPackage, openDatabase, saveEditorialPackage } from "../database/db.js";
import { detectMediaTools } from "../ffmpeg/detection.js";
import { generateCover } from "../editorial/cover.js";
import { validateEditorialPackage } from "../editorial/generator.js";
import type { EditorialPackage } from "../shared/types.js";
import { assertPathInside } from "../security/paths.js";
import { audit } from "./audit.js";

export type EditorialEdit = {
  caption?: string;
  selected_hook?: string;
  cta?: string;
  hashtags?: string[];
  cover_text?: string;
};

export async function editEditorialPackage(reelId: string, actor: string, changes: EditorialEdit, config: MediaConfig = loadConfig()): Promise<EditorialPackage> {
  if (!actor.trim()) throw new Error("ACTOR_REQUIRED");
  if (!Object.keys(changes).length) throw new Error("NO_EDITORIAL_CHANGES");
  const db = openDatabase(config);
  try {
    const current = latestEditorialPackage(db, reelId);
    const reel = derivedReelById(db, reelId);
    if (!current || !reel) throw new Error("REEL_OR_EDITORIAL_PACKAGE_NOT_FOUND");
    const next: EditorialPackage = {
      ...current,
      ...changes,
      hashtags: changes.hashtags ?? current.hashtags,
      editorial_version: current.editorial_version + 1,
      review_status: "READY_FOR_HUMAN_REVIEW",
      reviewed_by: null,
      reviewed_at: null,
      review_note: `Material editorial change by ${actor}`,
      generated_at: new Date().toISOString(),
    };
    const errors = validateEditorialPackage(next);
    if (errors.length) throw new Error(`EDITORIAL_VALIDATION_FAILED: ${errors.join(",")}`);
    const stored = saveEditorialPackage(db, next);
    const outputPath = config.reelsOutputRoot ? path.resolve(config.reelsOutputRoot, String(reel.output_relative_path)) : null;
    if (!outputPath || !config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
    await assertPathInside(config.reelsOutputRoot, outputPath);
    await fs.writeFile(outputPath.replace(/\.mp4$/i, ".editorial.json"), `${JSON.stringify(stored, null, 2)}\n`, "utf8");
    if (reel.metadata_relative_path) {
      const metadataPath = path.resolve(config.reelsOutputRoot, String(reel.metadata_relative_path));
      await assertPathInside(config.reelsOutputRoot, metadataPath);
      const technical = JSON.parse(await fs.readFile(metadataPath, "utf8")) as Record<string, unknown>;
      technical.editorial_package = stored;
      await fs.writeFile(metadataPath, `${JSON.stringify(technical, null, 2)}\n`, "utf8");
    }
    if (changes.cover_text !== undefined) {
      const tools = await detectMediaTools({ ...process.env, FFMPEG_BIN: config.ffmpegBin ?? process.env.FFMPEG_BIN, FFPROBE_BIN: config.ffprobeBin ?? process.env.FFPROBE_BIN });
      if (!tools.ffmpeg.executablePath || !tools.ffprobe.executablePath) throw new Error("FFMPEG_OR_FFPROBE_NOT_AVAILABLE");
      await assertPathInside(config.reelsOutputRoot, stored.cover_path, true);
      await generateCover({
        ffmpegPath: tools.ffmpeg.executablePath,
        ffprobePath: tools.ffprobe.executablePath,
        sourceReelPath: outputPath,
        outputPath: stored.cover_path,
        coverText: stored.cover_text,
        durationMs: Number(reel.duration_ms),
        fontPath: null,
        safeZoneTopPx: config.reelSafeZoneTopPx,
        safeZoneBottomPx: config.reelSafeZoneBottomPx,
        safeZoneSidePx: config.reelSafeZoneSidePx,
      });
    }
    audit(db, { entityType: "reel", entityId: reelId, eventType: "EDITORIAL_EDITED", actor, metadata: { editorial_version: stored.editorial_version, changed_fields: Object.keys(changes) } });
    return stored;
  } finally { db.close(); }
}
