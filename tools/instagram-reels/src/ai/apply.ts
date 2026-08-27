import { loadConfig, type MediaConfig } from "../config/index.js";
import { latestEditorialPackage, openDatabase } from "../database/db.js";
import { editEditorialPackage, type EditorialEdit } from "../publishing/editorial-edit.js";
import { audit } from "../publishing/audit.js";
import type { EditorialPackage } from "../shared/types.js";
import { AI_REVIEW_VERSION } from "./provider.js";

const EDITABLE_FIELDS = ["editorial_title", "selected_hook", "caption", "cta", "hashtags", "content_pillar", "secondary_pillar", "cover_text"] as const;
export type AiSuggestionField = typeof EDITABLE_FIELDS[number];

export async function applyEditorialSuggestion(reelId: string, fields: AiSuggestionField[], actor: string, note: string, config: MediaConfig = loadConfig()): Promise<EditorialPackage> {
  if (!actor.trim() || !note.trim()) throw new Error("ACTOR_AND_NOTE_REQUIRED");
  const selected = [...new Set(fields)].filter((field): field is AiSuggestionField => EDITABLE_FIELDS.includes(field));
  if (!selected.length) throw new Error("AI_SUGGESTION_FIELDS_REQUIRED");
  const db = openDatabase(config);
  let changes: EditorialEdit = {};
  let current: EditorialPackage | undefined;
  try {
    const row = db.prepare("SELECT suggested_package_json FROM ai_editorial_suggestions WHERE reel_id = ? AND ai_review_version = ?").get(reelId, AI_REVIEW_VERSION) as { suggested_package_json?: string } | undefined;
    if (!row?.suggested_package_json) throw new Error("AI_EDITORIAL_SUGGESTION_NOT_FOUND");
    const suggestion = JSON.parse(row.suggested_package_json) as Partial<EditorialPackage>;
    current = latestEditorialPackage(db, reelId);
    changes = Object.fromEntries(selected.filter((field) => suggestion[field] !== undefined).map((field) => [field, suggestion[field]])) as EditorialEdit;
    if (!Object.keys(changes).length) throw new Error("AI_SUGGESTION_FIELDS_NOT_AVAILABLE");
    if (changes.selected_hook && changes.caption === undefined && current) {
      changes.caption = current.caption.startsWith(current.selected_hook)
        ? `${changes.selected_hook}${current.caption.slice(current.selected_hook.length)}`
        : `${changes.selected_hook}\n\n${current.caption}`;
    }
  } finally { db.close(); }
  const stored = await editEditorialPackage(reelId, actor, changes, config);
  const dbAfter = openDatabase(config);
  try {
    dbAfter.prepare("UPDATE ai_editorial_suggestions SET status = 'APPLIED', updated_at = ? WHERE reel_id = ? AND ai_review_version = ?").run(new Date().toISOString(), reelId, AI_REVIEW_VERSION);
    audit(dbAfter, { entityType: "REEL", entityId: reelId, eventType: "AI_SUGGESTION_APPLIED", actor, metadata: { fields: Object.keys(changes), editorial_version: stored.editorial_version, note } });
  } finally { dbAfter.close(); }
  return stored;
}

export function aiSuggestionFields(): readonly AiSuggestionField[] { return EDITABLE_FIELDS; }
