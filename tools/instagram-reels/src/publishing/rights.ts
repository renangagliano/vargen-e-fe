import { loadConfig, type MediaConfig } from "../config/index.js";
import { inspectAsset, openDatabase, updateRightsStatus } from "../database/db.js";
import type { RightsStatus } from "../shared/types.js";
import { audit } from "./audit.js";

function transition(reelId: string, status: Extract<RightsStatus, "RIGHTS_CONFIRMED" | "RIGHTS_REJECTED">, actor: string, note: string, config: MediaConfig = loadConfig()): void {
  if (!actor.trim() || !note.trim()) throw new Error("RIGHTS_ACTOR_AND_NOTE_REQUIRED");
  const db = openDatabase(config);
  try {
    const asset = inspectAsset(db, String((db.prepare("SELECT source_asset_id FROM derived_reels WHERE reel_id = ?").get(reelId) as { source_asset_id?: string } | undefined)?.source_asset_id ?? ""));
    const current = db.prepare("SELECT rights_status FROM derived_reels WHERE reel_id = ?").get(reelId) as { rights_status?: string } | undefined;
    if (!asset || !current) throw new Error("REEL_NOT_FOUND");
    if (current.rights_status !== "RIGHTS_PENDING_CONFIRMATION") throw new Error("RIGHTS_TRANSITION_REQUIRES_PENDING_STATUS");
    updateRightsStatus(db, reelId, status, actor.trim(), note.trim());
    audit(db, { entityType: "REEL", entityId: reelId, eventType: status === "RIGHTS_CONFIRMED" ? "RIGHTS_CONFIRMED" : "RIGHTS_REJECTED", actor: actor.trim(), metadata: { note: note.trim() } });
  } finally { db.close(); }
}

export function confirmRights(reelId: string, actor: string, note: string, config: MediaConfig = loadConfig()): void {
  transition(reelId, "RIGHTS_CONFIRMED", actor, note, config);
}

export function rejectRights(reelId: string, actor: string, note: string, config: MediaConfig = loadConfig()): void {
  transition(reelId, "RIGHTS_REJECTED", actor, note, config);
}
