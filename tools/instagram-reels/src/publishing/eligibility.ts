import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/index.js";
import { loadAutomationConfig } from "../config/automation.js";
import { derivedReelById, inspectAsset, latestEditorialPackage, openDatabase, setPublicationStatus, successfulPublicationExists } from "../database/db.js";
import { sha256File } from "../media/checksum.js";
import { assertFileInsideRoot } from "../security/paths.js";
import type { EligibilityResult } from "../shared/types.js";
import { publicationKey } from "./jobs.js";
import { loadSongCatalog } from "../matching/catalog.js";

async function passSourceIntegrity(config: ReturnType<typeof loadConfig>, db: ReturnType<typeof openDatabase>, reel: Record<string, unknown>): Promise<boolean> {
  if (!config.mediaRoot || !reel.source_asset_id || !reel.source_checksum_before || reel.source_checksum_before !== reel.source_checksum_after) return false;
  const asset = inspectAsset(db, String(reel.source_asset_id));
  if (!asset?.relative_path) return false;
  const sourcePath = path.resolve(config.mediaRoot, String(asset.relative_path));
  try {
    await assertFileInsideRoot(config.mediaRoot, sourcePath);
    return (await sha256File(sourcePath)) === String(reel.source_checksum_before);
  } catch { return false; }
}

export async function evaluateEligibility(reelId: string, options: { at?: string; targetAccount?: string } = {}, config = loadConfig()): Promise<EligibilityResult> {
  const db = openDatabase(config);
  try {
    const reel = derivedReelById(db, reelId);
    const gates: Record<string, "PASS" | "FAIL" | "BLOCKED"> = {};
    const reasons: string[] = [];
    if (!reel) return { status: "BLOCKED", gates: { reel_exists: "FAIL" }, reasons: ["REEL_NOT_FOUND"] };
    gates.technical_validation = reel.validation_status === "PASS" ? "PASS" : "FAIL";
    if (gates.technical_validation === "FAIL") reasons.push("TECHNICAL_VALIDATION_FAILED");
    gates.source_integrity = (await passSourceIntegrity(config, db, reel)) ? "PASS" : "FAIL";
    if (gates.source_integrity === "FAIL") reasons.push("SOURCE_INTEGRITY_FAILED");
    const editorial = latestEditorialPackage(db, reelId);
    gates.editorial_review = editorial?.review_status === "APPROVED" ? "PASS" : "BLOCKED";
    if (gates.editorial_review !== "PASS") reasons.push("EDITORIAL_NOT_APPROVED");
    gates.rights_status = reel.rights_status === "RIGHTS_CONFIRMED" ? "PASS" : "BLOCKED";
    if (gates.rights_status !== "PASS") reasons.push("RIGHTS_NOT_CONFIRMED");
    gates.publication_status = reel.publication_status === "NOT_PUBLISHED" || reel.publication_status === "READY_FOR_PUBLISHING" ? "PASS" : "FAIL";
    if (gates.publication_status !== "PASS") reasons.push("PUBLICATION_STATUS_NOT_AVAILABLE");
    const account = options.targetAccount ?? "dry-run-account";
    const version = Number(editorial?.editorial_version ?? 0);
    const key = publicationKey(reelId, version, account);
    gates.duplicate_publication_check = successfulPublicationExists(db, key) ? "FAIL" : "PASS";
    if (gates.duplicate_publication_check === "FAIL") reasons.push("PUBLICATION_ALREADY_SUCCEEDED");
    const outputPath = config.reelsOutputRoot && reel.output_relative_path ? path.resolve(config.reelsOutputRoot, String(reel.output_relative_path)) : null;
    const coverPath = editorial?.cover_path ?? null;
    gates.output_file_exists = Boolean(outputPath && await fs.stat(outputPath).then((stats) => stats.size > 0).catch(() => false)) ? "PASS" : "FAIL";
    if (gates.output_file_exists === "FAIL") reasons.push("OUTPUT_FILE_MISSING");
    gates.cover_exists = Boolean(coverPath && await fs.stat(coverPath).then((stats) => stats.size > 0).catch(() => false)) ? "PASS" : "FAIL";
    if (gates.cover_exists === "FAIL") reasons.push("COVER_MISSING");
    gates.required_editorial_fields = Boolean(editorial?.selected_hook && editorial.caption && editorial.cta && editorial.hashtags.length >= 5 && editorial.editorial_title) ? "PASS" : "FAIL";
    if (gates.required_editorial_fields === "FAIL") reasons.push("EDITORIAL_FIELDS_INCOMPLETE");
    gates.bible_reference_valid = editorial?.bible_reference ? "PASS" : "FAIL";
    if (gates.bible_reference_valid === "FAIL") reasons.push("BIBLE_REFERENCE_MISSING");
    const automation = loadAutomationConfig();
    const plannedAt = options.at ?? new Date().toISOString();
    const plannedDate = new Date(plannedAt);
    const publicationRows = db.prepare("SELECT j.*, sm.song_slug FROM publication_jobs j LEFT JOIN derived_reels dr ON dr.reel_id = j.reel_id LEFT JOIN song_media_matches sm ON sm.asset_id = dr.source_asset_id WHERE j.status IN ('SCHEDULED','QUEUED','PUBLISHING','PUBLISHED')").all() as Array<Record<string, unknown>>;
    const eligibleRows = publicationRows.filter((row) => {
      const date = new Date(String(row.scheduled_at));
      return !Number.isNaN(date.getTime()) && date.getTime() <= plannedDate.getTime();
    });
    const lastDay = eligibleRows.filter((row) => plannedDate.getTime() - new Date(String(row.scheduled_at)).getTime() <= 24 * 60 * 60 * 1000);
    gates.content_frequency_rules = lastDay.length < automation.maxReelsPerDay ? "PASS" : "BLOCKED";
    if (gates.content_frequency_rules !== "PASS") reasons.push("MAX_REELS_PER_DAY_REACHED");
    const lastPublication = eligibleRows.sort((left, right) => new Date(String(right.scheduled_at)).getTime() - new Date(String(left.scheduled_at)).getTime())[0];
    const spacingHours = lastPublication ? (plannedDate.getTime() - new Date(String(lastPublication.scheduled_at)).getTime()) / (60 * 60 * 1000) : Number.POSITIVE_INFINITY;
    const source = inspectAsset(db, String(reel.source_asset_id));
    const catalog = await loadSongCatalog(config.repoRoot);
    const currentSong = catalog.find((entry) => entry.slug === String(source?.song_slug));
    const sameSongRecent = eligibleRows.filter((row) => row.song_slug && row.song_slug === source?.song_slug && plannedDate.getTime() - new Date(String(row.scheduled_at)).getTime() <= 30 * 24 * 60 * 60 * 1000).length;
    const recentCollections = eligibleRows
      .sort((left, right) => new Date(String(right.scheduled_at)).getTime() - new Date(String(left.scheduled_at)).getTime())
      .slice(0, automation.maxReelsPerCollectionConsecutively)
      .map((row) => catalog.find((entry) => entry.slug === String(row.song_slug))?.category)
      .filter(Boolean);
    const consecutiveCollectionConflict = Boolean(currentSong?.category && recentCollections.length >= automation.maxReelsPerCollectionConsecutively && recentCollections.every((category) => category === currentSong.category));
    gates.spacing_rules = spacingHours >= automation.minHoursBetweenReels && sameSongRecent < automation.maxReelsPerSongPer30Days && !consecutiveCollectionConflict ? "PASS" : "BLOCKED";
    if (spacingHours < automation.minHoursBetweenReels) reasons.push("MIN_HOURS_BETWEEN_REELS_NOT_MET");
    if (sameSongRecent >= automation.maxReelsPerSongPer30Days) reasons.push("MAX_REELS_PER_SONG_REACHED");
    if (consecutiveCollectionConflict) reasons.push("MAX_COLLECTION_CONSECUTIVE_REACHED");
    const status = Object.values(gates).every((value) => value === "PASS") ? "READY_FOR_PUBLISHING" : "BLOCKED";
    if (status === "READY_FOR_PUBLISHING" && reel.publication_status === "NOT_PUBLISHED") setPublicationStatus(db, reelId, "READY_FOR_PUBLISHING");
    return { status, gates, reasons: [...new Set(reasons)] };
  } finally { db.close(); }
}
