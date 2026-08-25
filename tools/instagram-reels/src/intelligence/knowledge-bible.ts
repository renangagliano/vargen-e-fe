import { createHash } from "node:crypto";
import type { MediaConfig } from "../config/index.js";
import { openDatabase } from "../database/db.js";
import { audit } from "../publishing/audit.js";
import type { KnowledgeBibleClassification, KnowledgeBibleResolution, AiBibleConfidence } from "../shared/types.js";
import type { ReviewItem } from "../review/service.js";
import { normalizeCatholicReference, parseCanonicalReference } from "./biblical.js";
import { loadKnowledgeBase, type KnowledgeBaseEntry } from "./knowledge-base.js";

export const KNOWLEDGE_BIBLE_RESOLVER_VERSION = "phase8-knowledge-bible-v1";

function hash(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function now(): string { return new Date().toISOString(); }
function text(value: unknown): string { return value === null || value === undefined ? "" : String(value); }
function normalize(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim(); }
function clamp(value: number): number { return Math.max(0, Math.min(100, Math.round(value * 100) / 100)); }
function referenceKey(value: string | null): string { return value ? normalize(normalizeCatholicReference(value)) : ""; }
function confidenceLevel(score: number): AiBibleConfidence { return score >= 75 ? "HIGH" : score >= 45 ? "MEDIUM" : "LOW"; }

function entryEvidence(entry: KnowledgeBaseEntry): string[] {
  const sources = ["src/data/knowledge-base/vargen-fe-knowledge-base-master.json"];
  const provenance = entry.provenance ?? {};
  if (provenance.catalog_source) sources.push(`Knowledge Base provenance: ${text(provenance.catalog_source)}`);
  if (provenance.curation_source) sources.push(`Knowledge Base provenance: ${text(provenance.curation_source)}`);
  return sources;
}

function evidenceText(entry: KnowledgeBaseEntry): string {
  const details = [entry.primary_bible_reference && `Referência primária: ${entry.primary_bible_reference}`, entry.biblical_story && `História: ${entry.biblical_story}`, entry.core_message && `Mensagem central: ${entry.core_message}`, entry.verification_status && `Governança: ${entry.verification_status}`].filter(Boolean);
  return details.join(" | ").slice(0, 900);
}

function calculateScore(entry: KnowledgeBaseEntry, item: ReviewItem): number {
  let score = 0;
  if (entry.primary_bible_reference) score += 30;
  if (entry.evidence_level.toUpperCase() === "CORROBORATED" || entry.evidence_level.toUpperCase() === "EXPLICIT") score += 20;
  if (entry.confidence.toUpperCase() === "HIGH") score += 18;
  else if (entry.confidence.toUpperCase() === "MEDIUM") score += 10;
  if (entry.verification_status.toUpperCase() === "READY_FOR_EDITORIAL_REVIEW") score += 8;
  if (entry.secondary_bible_references.length) score += Math.min(8, entry.secondary_bible_references.length * 3);
  const context = normalize(`${entry.biblical_story} ${entry.core_message} ${entry.primary_theme} ${entry.primary_bible_reference}`);
  const editorial = normalize(`${item.song_title} ${item.editorial?.editorial_title ?? ""} ${item.editorial?.caption ?? ""}`);
  const tokens = new Set(context.split(" ").filter((word) => word.length > 4));
  const alignment = [...tokens].filter((word) => editorial.includes(word)).length;
  score += Math.min(16, alignment * 3);
  return clamp(score);
}

export function classifyKnowledgeBible(entry: KnowledgeBaseEntry | undefined, item: ReviewItem, legacyReference: string | null = null): { classification: KnowledgeBibleClassification; suggestedReference: string | null; score: number; level: AiBibleConfidence; reason: string } {
  const humanReference = item.bible.status === "VERIFIED" ? item.bible.reference : null;
  if (humanReference) {
    const normalizedHuman = normalizeCatholicReference(humanReference);
    if (entry?.primary_bible_reference && referenceKey(entry.primary_bible_reference) !== referenceKey(normalizedHuman)) {
      return { classification: "CONFLICT", suggestedReference: normalizedHuman, score: 100, level: "HIGH", reason: `A referência HUMAN_VERIFIED (${normalizedHuman}) diverge do Knowledge Base (${normalizeCatholicReference(entry.primary_bible_reference)}). A verificação humana permanece soberana.` };
    }
    return { classification: "HUMAN_VERIFIED", suggestedReference: normalizedHuman, score: 100, level: "HIGH", reason: "Referência preservada de uma verificação humana anterior; o Knowledge Base não substitui esse registro." };
  }
  if (!entry || !entry.primary_bible_reference) return { classification: "INSUFFICIENT_EVIDENCE", suggestedReference: null, score: 0, level: "LOW", reason: "O Knowledge Base não possui uma referência primária suficiente para sugerir uma passagem. Nenhuma citação foi inventada." };
  const score = calculateScore(entry, item);
  const evidence = entry.evidence_level.toUpperCase();
  const confidence = entry.confidence.toUpperCase();
  if (["CONFLICT", "CONFLICTED"].includes(entry.verification_status.toUpperCase())) return { classification: "CONFLICT", suggestedReference: normalizeCatholicReference(entry.primary_bible_reference), score, level: confidenceLevel(score), reason: "O registro do Knowledge Base está marcado como conflitante e requer resolução humana." };
  if (evidence === "CORROBORATED" && confidence === "HIGH") return { classification: "KNOWLEDGE_CORROBORATED_HIGH", suggestedReference: normalizeCatholicReference(entry.primary_bible_reference), score, level: confidenceLevel(score), reason: "Sugestão baseada na referência primária e nos campos narrativos governados pelo Knowledge Base. Ainda requer verificação humana explícita." };
  if (confidence === "MEDIUM" || evidence.includes("INFER")) return { classification: "KNOWLEDGE_INFERRED_MEDIUM", suggestedReference: normalizeCatholicReference(entry.primary_bible_reference), score, level: confidenceLevel(score), reason: "O Knowledge Base fornece contexto suficiente para uma sugestão contextual, mas a evidência não é forte o bastante para dispensar revisão humana." };
  if (legacyReference && referenceKey(legacyReference) !== referenceKey(entry.primary_bible_reference)) return { classification: "CONFLICT", suggestedReference: normalizeCatholicReference(entry.primary_bible_reference), score, level: confidenceLevel(score), reason: `A sugestão do Knowledge Base (${entry.primary_bible_reference}) diverge da sugestão histórica não verificada (${legacyReference}); revisão humana necessária.` };
  return { classification: "KNOWLEDGE_REVIEW_REQUIRED", suggestedReference: normalizeCatholicReference(entry.primary_bible_reference), score, level: confidenceLevel(score), reason: "Há referência no Knowledge Base, mas sua classificação de governança exige revisão humana antes de qualquer uso como referência verificada." };
}

export async function resolveKnowledgeBible(item: ReviewItem, config: MediaConfig): Promise<KnowledgeBibleResolution> {
  const { bySlug, contentHash } = await loadKnowledgeBase(config);
  const entry = bySlug.get(item.song_slug);
  const db = openDatabase(config);
  try {
    const legacy = db.prepare("SELECT suggested_reference FROM biblical_resolution_suggestions WHERE reel_id = ? AND resolver_version = 'phase7.2-biblical-evidence-v1' ORDER BY updated_at DESC LIMIT 1").get(item.reel_id) as { suggested_reference?: string | null } | undefined;
    const result = classifyKnowledgeBible(entry, item, legacy?.suggested_reference ?? null);
    const parsed = parseCanonicalReference(result.suggestedReference);
    const sourceIds = entry ? entryEvidence(entry) : [];
    const resolution: KnowledgeBibleResolution = {
      resolution_id: `section8-bible-${hash(`${item.reel_id}:${KNOWLEDGE_BIBLE_RESOLVER_VERSION}`).slice(0, 32)}`,
      reel_id: item.reel_id, song_slug: item.song_slug, resolver_version: KNOWLEDGE_BIBLE_RESOLVER_VERSION,
      suggested_reference: result.suggestedReference, book: parsed.book, chapter: parsed.chapter, verse_start: parsed.verseStart, verse_end: parsed.verseEnd,
      classification: result.classification, confidence_level: result.level, confidence_score: result.score,
      evidence_level: entry?.evidence_level ?? "MISSING", knowledge_confidence: entry?.confidence ?? "LOW", verification_status: entry?.verification_status ?? "MISSING",
      biblical_story: entry?.biblical_story ?? "", core_message: entry?.core_message ?? "", provenance: entry?.provenance ?? {}, evidence_sources: sourceIds,
      legacy_reference: legacy?.suggested_reference ?? null, human_verified_reference: item.bible.status === "VERIFIED" ? item.bible.reference : null,
      conflict_reason: result.classification === "CONFLICT" ? result.reason : null,
      reasoning_summary: `${result.reason} Fonte do contexto: ${contentHash.slice(0, 16)}.`,
    };
    const timestamp = now();
    db.prepare(`INSERT INTO knowledge_bible_resolutions (resolution_id, reel_id, song_slug, resolver_version, suggested_reference, book, chapter, verse_start, verse_end, classification, confidence_level, confidence_score, evidence_level, knowledge_confidence, verification_status, biblical_story, core_message, provenance_json, evidence_sources_json, legacy_reference, human_verified_reference, conflict_reason, reasoning_summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(reel_id, resolver_version) DO UPDATE SET suggested_reference=excluded.suggested_reference, book=excluded.book, chapter=excluded.chapter, verse_start=excluded.verse_start, verse_end=excluded.verse_end, classification=excluded.classification, confidence_level=excluded.confidence_level, confidence_score=excluded.confidence_score, evidence_level=excluded.evidence_level, knowledge_confidence=excluded.knowledge_confidence, verification_status=excluded.verification_status, biblical_story=excluded.biblical_story, core_message=excluded.core_message, provenance_json=excluded.provenance_json, evidence_sources_json=excluded.evidence_sources_json, legacy_reference=excluded.legacy_reference, human_verified_reference=excluded.human_verified_reference, conflict_reason=excluded.conflict_reason, reasoning_summary=excluded.reasoning_summary, updated_at=excluded.updated_at`).run(
      resolution.resolution_id, resolution.reel_id, resolution.song_slug, resolution.resolver_version, resolution.suggested_reference, resolution.book, resolution.chapter, resolution.verse_start, resolution.verse_end, resolution.classification, resolution.confidence_level, resolution.confidence_score, resolution.evidence_level, resolution.knowledge_confidence, resolution.verification_status, resolution.biblical_story, resolution.core_message, JSON.stringify(resolution.provenance), JSON.stringify(resolution.evidence_sources), resolution.legacy_reference, resolution.human_verified_reference, resolution.conflict_reason, resolution.reasoning_summary, timestamp, timestamp,
    );
    audit(db, { eventId: `section8-bible-resolved:${item.reel_id}:${KNOWLEDGE_BIBLE_RESOLVER_VERSION}`, entityType: "REEL", entityId: item.reel_id, eventType: "KNOWLEDGE_BIBLE_RESOLVED", actor: "phase8-knowledge-engine", metadata: { resolver_version: KNOWLEDGE_BIBLE_RESOLVER_VERSION, classification: resolution.classification, confidence_score: resolution.confidence_score, source_count: sourceIds.length } });
    return resolution;
  } finally { db.close(); }
}
