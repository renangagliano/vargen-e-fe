import { loadConfig, type MediaConfig } from "../config/index.js";
import { latestEditorialPackage, openDatabase, updateEditorialReview } from "../database/db.js";
import type { EditorialReviewStatus } from "../shared/types.js";
import { audit } from "./audit.js";

export function setEditorialReview(reelId: string, version: number, status: EditorialReviewStatus, actor: string, note: string, config: MediaConfig = loadConfig()): void {
  if (!actor.trim() || !note.trim()) throw new Error("REVIEW_ACTOR_AND_NOTE_REQUIRED");
  const db = openDatabase(config);
  try {
    const latest = latestEditorialPackage(db, reelId);
    if (!latest) throw new Error("EDITORIAL_PACKAGE_NOT_FOUND");
    if (latest.editorial_version !== version) throw new Error("EDITORIAL_VERSION_NOT_LATEST");
    updateEditorialReview(db, reelId, version, status, actor.trim(), note.trim());
    audit(db, { entityType: "REEL", entityId: reelId, eventType: status === "APPROVED" ? "EDITORIAL_APPROVED" : status === "REJECTED" ? "EDITORIAL_REJECTED" : "EDITORIAL_NEEDS_CHANGES", actor: actor.trim(), metadata: { editorial_version: version, note: note.trim() } });
  } finally { db.close(); }
}

export function approveEditorial(reelId: string, version: number, actor: string, note: string, config: MediaConfig = loadConfig()): void {
  setEditorialReview(reelId, version, "APPROVED", actor, note, config);
}

export function rejectEditorial(reelId: string, version: number, actor: string, note: string, config: MediaConfig = loadConfig()): void {
  setEditorialReview(reelId, version, "REJECTED", actor, note, config);
}

export function requestEditorialChanges(reelId: string, version: number, actor: string, note: string, config: MediaConfig = loadConfig()): void {
  setEditorialReview(reelId, version, "NEEDS_CHANGES", actor, note, config);
}
