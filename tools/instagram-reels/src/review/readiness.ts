import fs from "node:fs/promises";
import path from "node:path";
import type { MediaConfig } from "../config/index.js";
import { derivedReelById, inspectAsset, latestEditorialPackage, openDatabase, successfulPublicationExists } from "../database/db.js";
import { sha256File } from "../media/checksum.js";
import { publicationKey } from "../publishing/jobs.js";
import { bibleReferenceStatus } from "./bible.js";
import { resolveReviewFile } from "./files.js";
import type { ContentReadinessStatus } from "../shared/types.js";

export type ContentReadiness = {
  reel_id: string;
  status: ContentReadinessStatus;
  editorial_version: number | null;
  gates: Record<string, "PASS" | "FAIL" | "BLOCKED">;
  reasons: string[];
  evaluated_at: string;
};

async function sourceIntegrity(config: MediaConfig, reel: Record<string, unknown>, db: ReturnType<typeof openDatabase>): Promise<boolean> {
  if (!config.mediaRoot || !reel.source_asset_id || !reel.source_checksum_before || reel.source_checksum_before !== reel.source_checksum_after) return false;
  const asset = inspectAsset(db, String(reel.source_asset_id));
  if (!asset?.relative_path) return false;
  const sourcePath = path.resolve(config.mediaRoot, String(asset.relative_path));
  try {
    const { assertFileInsideRoot } = await import("../security/paths.js");
    await assertFileInsideRoot(config.mediaRoot, sourcePath);
    return (await sha256File(sourcePath)) === String(reel.source_checksum_before);
  } catch { return false; }
}

export async function evaluateContentReadiness(reelId: string, config: MediaConfig): Promise<ContentReadiness> {
  const db = openDatabase(config);
  try {
    const reel = derivedReelById(db, reelId);
    const gates: Record<string, "PASS" | "FAIL" | "BLOCKED"> = {};
    const reasons: string[] = [];
    if (!reel) return { reel_id: reelId, status: "NOT_READY", editorial_version: null, gates: { reel_exists: "FAIL" }, reasons: ["REEL_NOT_FOUND"], evaluated_at: new Date().toISOString() };
    gates.technical_validation = reel.validation_status === "PASS" ? "PASS" : "FAIL";
    gates.source_integrity = await sourceIntegrity(config, reel, db) ? "PASS" : "FAIL";
    const editorial = latestEditorialPackage(db, reelId);
    gates.editorial_review = editorial?.review_status === "APPROVED" ? "PASS" : "BLOCKED";
    const rights = String(reel.rights_status) === "RIGHTS_CONFIRMED";
    gates.rights_status = rights ? "PASS" : "BLOCKED";
    const bible = bibleReferenceStatus(db, reelId);
    gates.bible_reference = bible.status === "VERIFIED" && Boolean(bible.reference) ? "PASS" : "BLOCKED";
    gates.output_file_exists = config.reelsOutputRoot && reel.output_relative_path
      ? await resolveReviewFile(config, String(reel.output_relative_path)).then(async ({ absolutePath }) => (await fs.stat(absolutePath)).size > 0 ? "PASS" : "FAIL").catch(() => "FAIL")
      : "FAIL";
    gates.cover_exists = editorial?.cover_path && config.reelsOutputRoot
      ? await resolveReviewFile(config, editorial.cover_path).then(async ({ absolutePath }) => (await fs.stat(absolutePath)).size > 0 ? "PASS" : "FAIL").catch(() => "FAIL")
      : "FAIL";
    gates.required_editorial_fields = editorial && editorial.editorial_title && editorial.selected_hook && editorial.caption && editorial.cta && editorial.hashtags.length >= 5 ? "PASS" : "FAIL";
    const key = publicationKey(reelId, Number(editorial?.editorial_version ?? 0), "dry-run-account");
    gates.duplicate_publication_check = successfulPublicationExists(db, key) ? "FAIL" : "PASS";
    if (gates.technical_validation !== "PASS") reasons.push("TECHNICAL_VALIDATION_FAILED");
    if (gates.source_integrity !== "PASS") reasons.push("SOURCE_INTEGRITY_FAILED");
    if (gates.editorial_review !== "PASS") reasons.push("EDITORIAL_NOT_APPROVED");
    if (gates.rights_status !== "PASS") reasons.push("RIGHTS_NOT_CONFIRMED");
    if (gates.bible_reference !== "PASS") reasons.push(`BIBLE_REFERENCE_${bible.status}`);
    if (gates.output_file_exists !== "PASS") reasons.push("OUTPUT_FILE_MISSING");
    if (gates.cover_exists !== "PASS") reasons.push("COVER_MISSING");
    if (gates.required_editorial_fields !== "PASS") reasons.push("EDITORIAL_FIELDS_INCOMPLETE");
    if (gates.duplicate_publication_check !== "PASS") reasons.push("PUBLICATION_ALREADY_SUCCEEDED");
    const status: ContentReadinessStatus = Object.values(gates).every((value) => value === "PASS") ? "CONTENT_READY" : "NOT_READY";
    const result = { reel_id: reelId, status, editorial_version: editorial?.editorial_version ?? null, gates, reasons: [...new Set(reasons)], evaluated_at: new Date().toISOString() };
    db.prepare(`
      INSERT INTO content_readiness (reel_id, status, editorial_version, gates_json, reasons_json, evaluated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(reel_id) DO UPDATE SET status = excluded.status, editorial_version = excluded.editorial_version, gates_json = excluded.gates_json, reasons_json = excluded.reasons_json, evaluated_at = excluded.evaluated_at
    `).run(reelId, result.status, result.editorial_version, JSON.stringify(result.gates), JSON.stringify(result.reasons), result.evaluated_at);
    return result;
  } finally { db.close(); }
}
