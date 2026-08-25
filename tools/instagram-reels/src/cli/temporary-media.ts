import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, type MediaConfig } from "../config/index.js";
import { openDatabase, temporaryMediaByReel } from "../database/db.js";
import { sha256File } from "../media/checksum.js";
import { evaluateContentReadiness } from "../review/readiness.js";
import { resolveReviewFile } from "../review/files.js";
import { freezePilotSnapshot, validatePilotSnapshot } from "../publishing/pilot.js";
import { AzureBlobTemporaryMediaProvider } from "../publishing/azure-temporary-media.js";

function option(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || undefined;
}

async function writeReport(config: MediaConfig, report: Record<string, unknown>): Promise<void> {
  if (!config.reelsOutputRoot) return;
  await fs.mkdir(config.reelsOutputRoot, { recursive: true });
  const jsonPath = path.join(config.reelsOutputRoot, "instagram-temp-media-report.json");
  const htmlPath = path.join(config.reelsOutputRoot, "instagram-temp-media-report.html");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const escaped = JSON.stringify(report, null, 2).replace(/[<&>]/g, (value) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[value] ?? value));
  await fs.writeFile(htmlPath, `<!doctype html><meta charset="utf-8"><title>Instagram Temporary Media</title><pre>${escaped}</pre>`, "utf8");
}

async function runDryRun(reelId: string, config: MediaConfig): Promise<Record<string, unknown>> {
  const snapshot = await freezePilotSnapshot(reelId, "temporary-media-dry-run", config);
  const readiness = await evaluateContentReadiness(reelId, config);
  if (readiness.status !== "CONTENT_READY") throw new Error(`CONTENT_READY_REQUIRED:${readiness.reasons.join(",")}`);
  const snapshotValidation = await validatePilotSnapshot(snapshot, config);
  if (!snapshotValidation.valid) throw new Error(`SNAPSHOT_INVALIDATED:${snapshotValidation.reason ?? "UNKNOWN"}`);
  const output = await resolveReviewFile(config, snapshot.derived_reel_relative_path);
  const before = await sha256File(output.absolutePath);
  const stats = await fs.stat(output.absolutePath);
  const after = await sha256File(output.absolutePath);
  if (stats.size <= 0 || before !== snapshot.derived_reel_checksum || after !== before) throw new Error("SNAPSHOT_INVALIDATED");
  return {
    generated_at: new Date().toISOString(),
    reel_id: reelId,
    provider: "DRY_RUN",
    content_ready: readiness.status,
    local_media: "PASS",
    checksum: "PASS",
    derived_checksum: before,
    blob_upload: "NO",
    azure_mutation: "NO",
    temporary_url_created: "NO",
    meta_calls: "NO",
    status: "DRY_RUN_VALIDATED",
  };
}

function printReport(report: Record<string, unknown>): void {
  console.log("Instagram Temporary Media");
  console.log("--------------------------");
  console.log(`Reel: ${String(report.reel_id ?? "NONE")}`);
  console.log(`Provider: ${String(report.provider ?? "UNKNOWN")}`);
  console.log(`CONTENT_READY: ${String(report.content_ready ?? "NOT_RUN")}`);
  console.log(`Local media: ${String(report.local_media ?? "NOT_RUN")}`);
  console.log(`Checksum: ${String(report.checksum ?? "NOT_RUN")}`);
  console.log(`Azure mutation: ${String(report.azure_mutation ?? "UNKNOWN")}`);
  console.log(`Temporary URL created: ${String(report.temporary_url_created ?? "UNKNOWN")}`);
  console.log(`Meta calls: ${String(report.meta_calls ?? "UNKNOWN")}`);
  console.log(`Status: ${String(report.status ?? "UNKNOWN")}`);
  if (report.safe_url) console.log(`Safe URL: ${String(report.safe_url)}`);
}

export async function runTemporaryMediaCommand(command: string | undefined, args: string[], config: MediaConfig = loadConfig()): Promise<boolean> {
  if (!command || !["instagram:media-prepare", "instagram:media-status", "instagram:media-cleanup"].includes(command)) return false;
  const reelId = option(args, "reel");
  if (command !== "instagram:media-cleanup" && !reelId) throw new Error("EXACTLY_ONE_REEL_REQUIRED");

  if (command === "instagram:media-status") {
    const db = openDatabase(config);
    try {
      const record = reelId ? temporaryMediaByReel(db, reelId) : undefined;
      console.log(JSON.stringify(record ?? { status: "NOT_PREPARED", reel_id: reelId ?? null }, null, 2));
    } finally { db.close(); }
    return true;
  }

  if (command === "instagram:media-cleanup") {
    if (option(args, "provider") !== "azure") throw new Error("AZURE_PROVIDER_REQUIRED");
    const provider = new AzureBlobTemporaryMediaProvider(config);
    if (args.includes("--expired")) {
      console.log(`Cleaned temporary blobs: ${await provider.cleanupExpiredMedia()}`);
    } else {
      if (!reelId) throw new Error("REEL_ID_OR_EXPIRED_REQUIRED");
      await provider.revokeTemporaryPublicUrl(reelId, "");
      console.log(`Cleaned temporary media for Reel: ${reelId}`);
    }
    return true;
  }

  const providerMode = option(args, "provider") ?? (args.includes("--dry-run") ? "dry-run" : "azure");
  if (args.includes("--dry-run") || providerMode === "dry-run") {
    const report = await runDryRun(reelId as string, config);
    await writeReport(config, report);
    printReport(report);
    return true;
  }
  if (providerMode !== "azure") throw new Error("TEMPORARY_MEDIA_PROVIDER_INVALID");
  const snapshot = await freezePilotSnapshot(reelId as string, "temporary-media-operator", config);
  const readiness = await evaluateContentReadiness(reelId as string, config);
  if (readiness.status !== "CONTENT_READY") throw new Error(`CONTENT_READY_REQUIRED:${readiness.reasons.join(",")}`);
  const provider = new AzureBlobTemporaryMediaProvider(config);
  const prepared = await provider.prepareTemporaryMedia({ reelId: snapshot.reel_id, publicationKey: snapshot.publication_key, derivedReelRelativePath: snapshot.derived_reel_relative_path, derivedChecksum: snapshot.derived_reel_checksum, editorialVersion: snapshot.editorial_version });
  const report = { generated_at: new Date().toISOString(), reel_id: prepared.reelId, song: snapshot.song, collection: snapshot.collection, provider: prepared.provider, blob_name: prepared.blobName, blob_size: prepared.blobSize, derived_checksum: prepared.derivedChecksum, expires_at: prepared.expiresAt, validation: prepared.validation, safe_url: prepared.safeUrl, cleanup_status: prepared.cleanupStatus, status: prepared.state, meta_calls: "NO" };
  await writeReport(config, report);
  printReport(report);
  return true;
}
