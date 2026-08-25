import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { loadConfig, type MediaConfig } from "../config/index.js";
import { derivedReelById, latestEditorialPackage, openDatabase } from "../database/db.js";
import { editEditorialPackage } from "../publishing/editorial-edit.js";
import { audit } from "../publishing/audit.js";
import type { BibleReferenceSource, BibleSourceType, BibleVerificationStatus, EditorialPackage } from "../shared/types.js";
import { normalizeBibleReference } from "../curation/bible.js";

const SOURCE_TYPES: BibleSourceType[] = ["CATALOG_METADATA", "SONG_METADATA", "LYRICS_METADATA", "PROJECT_DOCUMENTATION", "HUMAN_ENTERED", "OTHER_VERIFIED_LOCAL_SOURCE"];
const REVIEWABLE_STATUSES: BibleVerificationStatus[] = ["VERIFIED", "REVIEW_REQUIRED", "MISSING", "CONFLICT"];

export function isBibleSourceType(value: string): value is BibleSourceType {
  return SOURCE_TYPES.includes(value as BibleSourceType);
}

export function isBibleReferenceStructurallyValid(value: string): boolean {
  const reference = normalizeBibleReference(value);
  if (!reference || reference.length > 120) return false;
  return /^(?:(?:[1-3]\s+)?[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+)*)\s+\d+(?:,\d+(?:-\d+)?(?:\.\d+(?:-\d+)?)*)?$/u.test(reference);
}

export type BibleGovernanceResult = {
  status: BibleVerificationStatus;
  reference: string | null;
  source: BibleReferenceSource | null;
  evidence: string;
};

type Row = Record<string, unknown>;

function timestamp(): string { return new Date().toISOString(); }

function sourceFromRow(row: Row | undefined): BibleReferenceSource | null {
  if (!row) return null;
  return {
    bible_reference_id: String(row.bible_reference_id),
    reel_id: String(row.reel_id),
    editorial_version: row.editorial_version === null || row.editorial_version === undefined ? null : Number(row.editorial_version),
    reference: String(row.reference),
    source_type: String(row.source_type) as BibleSourceType,
    source_location: String(row.source_location),
    verification_status: String(row.verification_status) as BibleVerificationStatus,
    verified_by: row.verified_by ? String(row.verified_by) : null,
    verified_at: row.verified_at ? String(row.verified_at) : null,
    note: row.note ? String(row.note) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function latestSourceRow(db: DatabaseSync, reelId: string): Row | undefined {
  return db.prepare("SELECT * FROM bible_reference_sources WHERE reel_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1").get(reelId) as Row | undefined;
}

/**
 * Preserve the three references already validated during the pilot. This is
 * not semantic inference: it records the prior package as the evidence
 * source, while all new operator-entered references start REVIEW_REQUIRED.
 */
export function ensureLegacyBibleEvidence(db: DatabaseSync): void {
  const rows = db.prepare("SELECT reel_id, editorial_version, package_json, created_at FROM reel_editorial_packages WHERE bible_reference <> '' ORDER BY editorial_version DESC").all() as Row[];
  const seen = new Set<string>();
  for (const row of rows) {
    const reelId = String(row.reel_id);
    if (seen.has(reelId)) continue;
    seen.add(reelId);
    const packageValue = JSON.parse(String(row.package_json)) as EditorialPackage;
    if (!packageValue.bible_reference.trim() || packageValue.bible_reference_review_required) continue;
    if (latestSourceRow(db, reelId)) continue;
    const now = timestamp();
    db.prepare(`
      INSERT INTO bible_reference_sources (
        bible_reference_id, reel_id, editorial_version, reference, source_type,
        source_location, verification_status, verified_by, verified_at, note,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'PROJECT_DOCUMENTATION', ?, 'VERIFIED', ?, ?, ?, ?, ?)
    `).run(
      `bible-${randomUUID()}`, reelId, Number(row.editorial_version), normalizeBibleReference(packageValue.bible_reference),
      `reel_editorial_packages/${reelId}/v${row.editorial_version}`, "phase4-validation", String(row.created_at),
      "Preservada da validação editorial do piloto; não inferida pelo título.", now, now,
    );
    audit(db, { entityType: "REEL", entityId: reelId, eventType: "BIBLE_REFERENCE_RESOLVED", actor: "phase4-validation", metadata: { source_type: "PROJECT_DOCUMENTATION", source_location: `reel_editorial_packages/${reelId}/v${row.editorial_version}` } });
  }
}

export function bibleReferenceStatus(db: DatabaseSync, reelId: string): BibleGovernanceResult {
  ensureLegacyBibleEvidence(db);
  const source = sourceFromRow(latestSourceRow(db, reelId));
  if (source) {
    return { status: source.verification_status, reference: source.reference || null, source, evidence: source.source_location };
  }
  const editorial = latestEditorialPackage(db, reelId);
  if (!editorial?.bible_reference?.trim()) return { status: "MISSING", reference: null, source: null, evidence: "Nenhuma referência local registrada." };
  if (editorial.bible_reference_review_required) return { status: "REVIEW_REQUIRED", reference: normalizeBibleReference(editorial.bible_reference), source: null, evidence: "Referência presente, mas ainda não verificada pelo operador." };
  return { status: "REVIEW_REQUIRED", reference: normalizeBibleReference(editorial.bible_reference), source: null, evidence: "Referência sem registro de fonte verificável." };
}

function requireActor(actor: string, note: string): void {
  if (!actor.trim() || !note.trim()) throw new Error("BIBLE_ACTOR_AND_NOTE_REQUIRED");
}

function requireSourceType(sourceType: string): asserts sourceType is BibleSourceType {
  if (!isBibleSourceType(sourceType)) throw new Error("BIBLE_SOURCE_TYPE_INVALID");
}

export async function saveBibleReferenceDraft(input: {
  reelId: string;
  reference: string;
  actor: string;
  note: string;
  sourceType?: BibleSourceType;
  sourceLocation?: string;
  verify?: boolean;
}, config: MediaConfig = loadConfig()): Promise<{ package: EditorialPackage; source: BibleReferenceSource }> {
  requireActor(input.actor, input.note);
  const reference = normalizeBibleReference(input.reference);
  if (!isBibleReferenceStructurallyValid(reference)) throw new Error("BIBLE_REFERENCE_FORMAT_INVALID");
  const sourceType = input.sourceType ?? "HUMAN_ENTERED";
  requireSourceType(sourceType);
  const sourceLocation = input.sourceLocation?.trim() || "local-review-cockpit";
  const db = openDatabase(config);
  try {
    if (!derivedReelById(db, input.reelId) || !latestEditorialPackage(db, input.reelId)) throw new Error("REEL_OR_EDITORIAL_PACKAGE_NOT_FOUND");
    const current = latestSourceRow(db, input.reelId);
    if (current && String(current.verification_status) === "VERIFIED" && normalizeBibleReference(String(current.reference)) !== reference) {
      throw new Error("BIBLE_REFERENCE_CONFLICT_WITH_VERIFIED_SOURCE");
    }
  } finally { db.close(); }

  const packageValue = await editEditorialPackage(input.reelId, input.actor, {
    bible_reference: reference,
    bible_reference_review_required: true,
  }, config);
  const dbAfter = openDatabase(config);
  try {
    const now = timestamp();
    const sourceId = `bible-${randomUUID()}`;
    dbAfter.prepare(`
      INSERT INTO bible_reference_sources (
        bible_reference_id, reel_id, editorial_version, reference, source_type,
        source_location, verification_status, verified_by, verified_at, note,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'REVIEW_REQUIRED', NULL, NULL, ?, ?, ?)
    `).run(sourceId, input.reelId, packageValue.editorial_version, reference, sourceType, sourceLocation, input.note.trim(), now, now);
    audit(dbAfter, { entityType: "REEL", entityId: input.reelId, eventType: "BIBLE_REFERENCE_ENTERED", actor: input.actor.trim(), metadata: { editorial_version: packageValue.editorial_version, source_type: sourceType, source_location: sourceLocation } });
    const source = sourceFromRow(dbAfter.prepare("SELECT * FROM bible_reference_sources WHERE bible_reference_id = ?").get(sourceId) as Row);
    if (!source) throw new Error("BIBLE_SOURCE_PERSISTENCE_FAILED");
    if (input.verify) {
      dbAfter.close();
      await verifyBibleReference(input.reelId, input.actor, input.note, config);
      const verifiedDb = openDatabase(config);
      try {
        const verified = sourceFromRow(latestSourceRow(verifiedDb, input.reelId));
        if (!verified) throw new Error("BIBLE_SOURCE_PERSISTENCE_FAILED");
        return { package: await importLatestPackage(input.reelId, config), source: verified };
      } finally { verifiedDb.close(); }
    }
    return { package: packageValue, source };
  } finally {
    // The verify branch closes this handle before reopening it.
    try { dbAfter.close(); } catch { /* already closed */ }
  }
}

async function importLatestPackage(reelId: string, config: MediaConfig): Promise<EditorialPackage> {
  const db = openDatabase(config);
  try {
    const value = latestEditorialPackage(db, reelId);
    if (!value) throw new Error("EDITORIAL_PACKAGE_NOT_FOUND");
    return value;
  } finally { db.close(); }
}

export async function verifyBibleReference(reelId: string, actor: string, note: string, config: MediaConfig = loadConfig()): Promise<BibleReferenceSource> {
  requireActor(actor, note);
  const db = openDatabase(config);
  let source: BibleReferenceSource | null;
  try {
    ensureLegacyBibleEvidence(db);
    source = sourceFromRow(latestSourceRow(db, reelId));
    if (!source) throw new Error("BIBLE_REFERENCE_NOT_FOUND");
    if (source.verification_status === "VERIFIED") return source;
    if (source.verification_status === "CONFLICT") throw new Error("BIBLE_REFERENCE_CONFLICT");
    if (!isBibleReferenceStructurallyValid(source.reference)) throw new Error("BIBLE_REFERENCE_FORMAT_INVALID");
    db.prepare("UPDATE bible_reference_sources SET verification_status = 'VERIFIED', verified_by = ?, verified_at = ?, note = ?, updated_at = ? WHERE bible_reference_id = ?").run(actor.trim(), timestamp(), note.trim(), timestamp(), source.bible_reference_id);
  } finally { db.close(); }

  const current = await importLatestPackage(reelId, config);
  if (current.bible_reference_review_required) {
    await editEditorialPackage(reelId, actor, { bible_reference_review_required: false }, config);
  }
  const verifiedDb = openDatabase(config);
  try {
    const updated = sourceFromRow(latestSourceRow(verifiedDb, reelId));
    if (!updated) throw new Error("BIBLE_REFERENCE_NOT_FOUND");
    audit(verifiedDb, { entityType: "REEL", entityId: reelId, eventType: "BIBLE_REFERENCE_VERIFIED", actor: actor.trim(), metadata: { reference: updated.reference, source_type: updated.source_type } });
    audit(verifiedDb, { eventId: `section9-bible-human-verified:${reelId}:${updated.reference}`, entityType: "REEL", entityId: reelId, eventType: "BIBLE_HUMAN_VERIFIED", actor: actor.trim(), metadata: { reference: updated.reference, source_type: updated.source_type, verification: "explicit_operator_action" } });
    return updated;
  } finally { verifiedDb.close(); }
}

export function listBibleSources(config: MediaConfig = loadConfig()): BibleReferenceSource[] {
  const db = openDatabase(config);
  try {
    ensureLegacyBibleEvidence(db);
    return db.prepare("SELECT * FROM bible_reference_sources ORDER BY updated_at DESC").all().map((row) => sourceFromRow(row as Row)).filter((value): value is BibleReferenceSource => Boolean(value));
  } finally { db.close(); }
}

export function isBibleVerificationStatus(value: string): value is BibleVerificationStatus {
  return REVIEWABLE_STATUSES.includes(value as BibleVerificationStatus);
}
