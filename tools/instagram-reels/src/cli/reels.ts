import { loadConfig } from "../config/index.js";
import { candidateById, derivedReelById, openDatabase } from "../database/db.js";
import { analyzeAsset, generatePilot, listStoredCandidates } from "../reels/pipeline.js";
import { validateReel } from "../reels/validation.js";
import { inspectAsset } from "../database/db.js";
import path from "node:path";

function assetArgument(args: string[]): string {
  const value = args.find((arg) => !arg.startsWith("--"));
  if (!value) throw new Error("USAGE: reel:analyze|reel:candidates|reel:generate <asset-id>");
  return value;
}

export async function analyzeReelAsset(assetId: string): Promise<void> {
  const result = await analyzeAsset(assetId);
  console.log(JSON.stringify({ asset_id: assetId, audio_sample_count: result.audioSampleCount, scene_change_count: result.sceneChangeCount, candidates: result.candidates }, null, 2));
}

export async function listReelCandidates(assetId: string): Promise<void> {
  console.log(JSON.stringify(await listStoredCandidates(assetId), null, 2));
}

export async function generateReelPilot(assetId: string): Promise<void> {
  const result = await generatePilot(assetId);
  console.log(JSON.stringify({
    source: result.context,
    review_manifest_path: result.reviewManifestPath,
    generated: result.generated.map((item) => ({
      reel_id: item.reelId,
      candidate: item.candidate,
      output_path: item.outputPath,
      thumbnail_path: item.thumbnailPath,
      metadata_path: item.metadataPath,
      validation: item.validation,
    })),
  }, null, 2));
}

export async function inspectReel(reelId: string): Promise<void> {
  const db = openDatabase(loadConfig());
  try {
    const row = derivedReelById(db, reelId);
    if (!row) throw new Error(`REEL_NOT_FOUND: ${reelId}`);
    const candidate = candidateById(db, String(row.candidate_id));
    console.log(JSON.stringify({ reel: row, candidate }, null, 2));
  } finally { db.close(); }
}

export async function validateStoredReel(reelId: string): Promise<void> {
  const config = loadConfig();
  if (!config.mediaRoot || !config.reelsOutputRoot) throw new Error("MEDIA_OR_OUTPUT_ROOT_NOT_CONFIGURED");
  const db = openDatabase(config);
  try {
    const row = derivedReelById(db, reelId);
    if (!row) throw new Error(`REEL_NOT_FOUND: ${reelId}`);
    const candidateRow = candidateById(db, String(row.candidate_id));
    const assetRow = inspectAsset(db, String(row.source_asset_id));
    if (!candidateRow || !assetRow?.relative_path) throw new Error("REEL_PROVENANCE_INCOMPLETE");
    const candidate = {
      candidateId: String(candidateRow.candidate_id), sourceAssetId: String(candidateRow.source_asset_id), startTimeMs: Number(candidateRow.start_time_ms), endTimeMs: Number(candidateRow.end_time_ms), durationMs: Number(candidateRow.duration_ms), category: String(candidateRow.category) as never, score: Number(candidateRow.score), selectionReason: String(candidateRow.selection_reason), status: String(candidateRow.status) as never, fingerprint: String(candidateRow.fingerprint),
    };
    const outputPath = path.join(config.reelsOutputRoot, String(row.output_relative_path));
    const result = await validateReel({ config, ffprobePath: config.ffprobeBin ?? "ffprobe", sourcePath: path.join(config.mediaRoot, String(assetRow.relative_path)), outputPath, candidate });
    console.log(JSON.stringify({ reel_id: reelId, ...result }, null, 2));
    if (result.status !== "PASS") process.exitCode = 1;
  } finally { db.close(); }
}

export { assetArgument };
