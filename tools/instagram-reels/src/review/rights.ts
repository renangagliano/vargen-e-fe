import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { loadConfig, type MediaConfig } from "../config/index.js";
import { assetById, derivedReelsForAsset, openDatabase, updateRightsStatus } from "../database/db.js";
import { audit } from "../publishing/audit.js";
import type { RightsStatus } from "../shared/types.js";

export const RIGHTS_CONFIRMATION_STATEMENT_VERSION = "rights-confirmation-v1";
export const RIGHTS_CONFIRMATION_STATEMENT = "I confirm that I have the necessary rights or authorization to use and publish this media for the Vargen & Fé project.";

function now(): string { return new Date().toISOString(); }
function requireActor(actor: string, note: string): void { if (!actor.trim() || !note.trim()) throw new Error("RIGHTS_ACTOR_AND_NOTE_REQUIRED"); }

export function sourceRightsStatus(assetId: string, config: MediaConfig = loadConfig()): Record<string, unknown> {
  const db = openDatabase(config);
  try {
    const asset = assetById(db, assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    const history = db.prepare("SELECT * FROM source_rights_history WHERE asset_id = ? ORDER BY confirmed_at DESC").all(assetId) as Array<Record<string, unknown>>;
    return { asset_id: assetId, rights_status: String(asset.rights_status), derived_count: derivedReelsForAsset(db, assetId).length, history };
  } finally { db.close(); }
}

export function confirmSourceRights(assetId: string, actor: string, note: string, confirmationStatement: string, config: MediaConfig): Record<string, unknown> {
  requireActor(actor, note);
  if (confirmationStatement !== RIGHTS_CONFIRMATION_STATEMENT) throw new Error("RIGHTS_CONFIRMATION_STATEMENT_REQUIRED");
  return transitionSourceRights(assetId, "RIGHTS_CONFIRMED", actor, note, config);
}

export function rejectSourceRights(assetId: string, actor: string, note: string, config: MediaConfig): Record<string, unknown> {
  requireActor(actor, note);
  return transitionSourceRights(assetId, "RIGHTS_REJECTED", actor, note, config);
}

export function transitionSourceRights(assetId: string, status: Extract<RightsStatus, "RIGHTS_CONFIRMED" | "RIGHTS_REJECTED">, actor: string, note: string, config: MediaConfig): Record<string, unknown> {
  requireActor(actor, note);
  const db = openDatabase(config);
  try {
    const asset = assetById(db, assetId);
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    const current = String(asset.rights_status);
    if (current === status) return { asset_id: assetId, rights_status: status, idempotent: true, derived_count: derivedReelsForAsset(db, assetId).length };
    const timestamp = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE media_assets SET rights_status = ?, updated_at = ?, last_seen_at = last_seen_at WHERE asset_id = ?").run(status, timestamp, assetId);
      const derived = derivedReelsForAsset(db, assetId);
      for (const reel of derived) {
        updateRightsStatus(db, String(reel.reel_id), status, actor.trim(), note.trim());
        audit(db, { entityType: "REEL", entityId: String(reel.reel_id), eventType: status === "RIGHTS_CONFIRMED" ? "RIGHTS_CONFIRMED_FROM_SOURCE" : "RIGHTS_REJECTED_FROM_SOURCE", actor: actor.trim(), metadata: { asset_id: assetId, inherited: true } });
      }
      db.prepare(`
        INSERT INTO source_rights_history (
          confirmation_id, asset_id, rights_status, confirmed_by, confirmed_at,
          confirmation_scope, confirmation_statement_version, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(`rights-${randomUUID()}`, assetId, status, actor.trim(), timestamp, "SOURCE_AND_DERIVED_REELS", RIGHTS_CONFIRMATION_STATEMENT_VERSION, note.trim());
      audit(db, { entityType: "ASSET", entityId: assetId, eventType: status === "RIGHTS_CONFIRMED" ? "RIGHTS_CONFIRMED" : "RIGHTS_REJECTED", actor: actor.trim(), metadata: { scope: "SOURCE_AND_DERIVED_REELS", statement_version: RIGHTS_CONFIRMATION_STATEMENT_VERSION } });
      db.exec("COMMIT");
      return { asset_id: assetId, rights_status: status, derived_count: derived.length, idempotent: false };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
      throw error;
    }
  } finally { db.close(); }
}

export async function confirmSourcesFromManifest(manifestPath: string, actor: string, note: string, confirmation: string, config: MediaConfig): Promise<Record<string, unknown>> {
  requireActor(actor, note);
  if (confirmation !== "I_CONFIRM_RIGHTS") throw new Error("BULK_RIGHTS_CONFIRMATION_REQUIRED");
  const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { asset_ids?: unknown[]; assets?: Array<{ asset_id?: unknown }> };
  const assetIds = (parsed.asset_ids ?? parsed.assets?.map((item) => item.asset_id) ?? []).map(String).filter(Boolean);
  if (!assetIds.length) throw new Error("BULK_RIGHTS_MANIFEST_EMPTY");
  const results = assetIds.map((assetId) => confirmSourceRights(assetId, actor, note, RIGHTS_CONFIRMATION_STATEMENT, config));
  return { scope: "SOURCE_AND_DERIVED_REELS", assets_requested: assetIds.length, results };
}

export function rightsSummary(config: MediaConfig): Record<string, unknown> {
  const db = openDatabase(config);
  try {
    const sources = db.prepare("SELECT rights_status, COUNT(*) AS count FROM media_assets GROUP BY rights_status").all() as Array<Record<string, unknown>>;
    const reels = db.prepare("SELECT rights_status, COUNT(*) AS count FROM derived_reels GROUP BY rights_status").all() as Array<Record<string, unknown>>;
    return { sources, reels, confirmation_statement_version: RIGHTS_CONFIRMATION_STATEMENT_VERSION };
  } finally { db.close(); }
}
