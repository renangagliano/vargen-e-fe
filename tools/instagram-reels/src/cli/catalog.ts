import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/index.js";
import { allLocations, assetById, duplicateChecksums, inspectAsset, listAssets, openDatabase, setLocationExists } from "../database/db.js";
import { checkLocalAvailability } from "../media/availability.js";
import { sha256File } from "../media/checksum.js";
import { assertFileInsideRoot } from "../security/paths.js";

function printable(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

export async function listCatalog(filter?: string): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config);
  try {
    const rows = listAssets(db, filter);
    if (rows.length === 0) { console.log("No indexed media assets."); return; }
    console.log("asset_id\tfilename\tduration_ms\tresolution\tavailability\tsong_match\trights_status");
    for (const row of rows) console.log([row.asset_id, row.source_filename, row.duration_ms ?? "—", `${row.width ?? "?"}x${row.height ?? "?"}`, row.availability_status, row.match_status, row.rights_status].map(printable).join("\t"));
  } finally { db.close(); }
}

export async function inspectCatalog(assetId: string | undefined): Promise<void> {
  if (!assetId) throw new Error("USAGE: media:inspect <asset-id>");
  const db = openDatabase(loadConfig());
  try {
    const row = inspectAsset(db, assetId);
    if (!row) throw new Error(`ASSET_NOT_FOUND: ${assetId}`);
    for (const [key, value] of Object.entries(row)) console.log(`${key}: ${printable(value)}`);
  } finally { db.close(); }
}

export async function verifyCatalog(): Promise<void> {
  const config = loadConfig();
  if (!config.mediaRoot) throw new Error("MEDIA_ROOT_NOT_CONFIGURED: set VARGEN_MEDIA_ROOT before verify.");
  const db = openDatabase(config);
  const report: Array<Record<string, string>> = [];
  try {
    for (const location of allLocations(db)) {
      const relativePath = String(location.relative_path);
      const absolutePath = path.resolve(config.mediaRoot, relativePath);
      try {
        await assertFileInsideRoot(config.mediaRoot, absolutePath);
        const availability = await checkLocalAvailability(absolutePath);
        if (availability !== "LOCAL_AVAILABLE") {
          setLocationExists(db, relativePath, false);
          report.push({ relativePath, status: availability });
          continue;
        }
        const checksum = await sha256File(absolutePath);
        const asset = assetById(db, String(location.asset_id));
        const status = asset?.checksum_sha256 === checksum ? "UNCHANGED" : "CHANGED_CONTENT";
        setLocationExists(db, relativePath, true);
        report.push({ relativePath, status, checksum });
      } catch (error) {
        setLocationExists(db, relativePath, false);
        report.push({ relativePath, status: "MISSING_OR_ACCESS_ERROR", error: error instanceof Error ? error.message : String(error) });
      }
    }
    const duplicates = duplicateChecksums(db);
    console.log(JSON.stringify({ checked: report.length, unchanged: report.filter((item) => item.status === "UNCHANGED").length, changed: report.filter((item) => item.status === "CHANGED_CONTENT").length, missingOrUnavailable: report.filter((item) => item.status !== "UNCHANGED" && item.status !== "CHANGED_CONTENT").length, duplicateChecksums: duplicates.length, report, duplicates }, null, 2));
  } finally { db.close(); }
}
