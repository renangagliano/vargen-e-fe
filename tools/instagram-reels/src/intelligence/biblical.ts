import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, type MediaConfig } from "../config/index.js";
import { openDatabase } from "../database/db.js";
import { listReviewItems, type ReviewItem } from "../review/service.js";
import type { BiblicalResolutionConfidence, BiblicalResolutionStatus, BiblicalResolutionType } from "../shared/types.js";
import { extractExplicitReferences } from "./registry.js";

export const BIBLICAL_RESOLVER_VERSION = "phase7.2-biblical-evidence-v1";
type Row = Record<string, unknown>;

function now(): string { return new Date().toISOString(); }
function stableId(value: string): string { return `bib-resolution-${createHash("sha256").update(value).digest("hex").slice(0, 32)}`; }
function text(value: unknown): string { return value === null || value === undefined ? "" : String(value); }
function normalize(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim(); }

const BOOK_ALIASES: Array<[RegExp, string]> = [
  [/^salmos?$/iu, "Salmo"],
  [/^cantico dos canticos$/iu, "Cântico dos Cânticos"],
  [/^1\s+samuel$/iu, "1 Samuel"],
  [/^2\s+samuel$/iu, "2 Samuel"],
  [/^1\s+reis$/iu, "1 Reis"],
  [/^2\s+reis$/iu, "2 Reis"],
  [/^1\s+corintios$/iu, "1 Coríntios"],
  [/^2\s+corintios$/iu, "2 Coríntios"],
  [/^1\s+pedro$/iu, "1 Pedro"],
  [/^2\s+pedro$/iu, "2 Pedro"],
  [/^1\s+joao$/iu, "1 João"],
  [/^2\s+joao$/iu, "2 João"],
  [/^3\s+joao$/iu, "3 João"],
];

export function normalizeCatholicReference(value: string): string {
  const compact = value.replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").replace(/\s*[-–—]\s*/g, "-").trim();
  const match = compact.match(/^(.*?)\s+(\d+)(?:,(.+))?$/u);
  if (!match) return compact;
  const book = BOOK_ALIASES.find(([pattern]) => pattern.test(normalize(match[1])))?.[1] ?? match[1].trim();
  return `${book} ${match[2]}${match[3] ? `,${match[3].replace(/\s+/g, "")}` : ""}`;
}

export function parseCanonicalReference(value: string | null): { book: string | null; chapter: number | null; verseStart: number | null; verseEnd: number | null; displayReference: string | null } {
  if (!value?.trim()) return { book: null, chapter: null, verseStart: null, verseEnd: null, displayReference: null };
  const displayReference = normalizeCatholicReference(value);
  const match = displayReference.match(/^(.*?)\s+(\d+)(?:,(\d+)(?:-(\d+))?)?$/u);
  return { book: match?.[1] ?? displayReference, chapter: match ? Number(match[2]) : null, verseStart: match?.[3] ? Number(match[3]) : null, verseEnd: match?.[4] ? Number(match[4]) : match?.[3] ? Number(match[3]) : null, displayReference };
}

type Resolution = {
  song_slug: string;
  reel_id: string;
  suggested_reference: string | null;
  resolution_type: BiblicalResolutionType;
  confidence: BiblicalResolutionConfidence;
  evidence_source_record_ids: string[];
  evidence_excerpt_safe: string;
  reasoning_summary: string;
  status: BiblicalResolutionStatus;
};

function sourceMetadata(row: Row): Record<string, unknown> {
  try { return JSON.parse(text(row.metadata_json_safe) || "{}"); } catch { return {}; }
}

function resolveFromRows(item: ReviewItem, rows: Row[]): Resolution {
  const authoritative = rows.filter((row) => Number(row.is_authoritative) === 1 && text(row.source_type) !== "GENERATED_EDITORIAL");
  if (item.bible.status === "VERIFIED" && item.bible.reference) {
    const evidence = authoritative.filter((row) => sourceMetadata(row).reference === item.bible.reference || text(row.source_type) === "HUMAN_PROVIDED_REFERENCE");
    return { song_slug: item.song_slug, reel_id: item.reel_id, suggested_reference: normalizeCatholicReference(item.bible.reference), resolution_type: "HUMAN_VERIFIED", confidence: "HIGH", evidence_source_record_ids: evidence.map((row) => text(row.source_record_id)), evidence_excerpt_safe: evidence.map((row) => text(sourceMetadata(row).evidence_excerpt_safe || sourceMetadata(row).evidence_role || "Verificação humana existente.")).join(" | ").slice(0, 600), reasoning_summary: "Referência já verificada anteriormente no fluxo humano; esta camada apenas preserva sua proveniência.", status: "HUMAN_VERIFIED" };
  }

  const explicit = new Map<string, { ids: string[]; excerpts: string[] }>();
  for (const row of authoritative) {
    const metadata = sourceMetadata(row);
    const refs = Array.isArray(metadata.explicit_references) ? metadata.explicit_references.map(String) : [];
    for (const reference of refs) {
      const canonical = normalizeCatholicReference(reference);
      const key = normalize(canonical);
      const current = explicit.get(key) ?? { ids: [], excerpts: [] };
      current.ids.push(text(row.source_record_id));
      current.excerpts.push(text(metadata.evidence_excerpt_safe || `${row.source_type}: ${row.source_location}`));
      explicit.set(key, current);
    }
  }
  if (explicit.size > 1) {
    const entries = [...explicit.entries()];
    return { song_slug: item.song_slug, reel_id: item.reel_id, suggested_reference: null, resolution_type: "CONFLICT", confidence: "HIGH", evidence_source_record_ids: entries.flatMap(([, value]) => value.ids), evidence_excerpt_safe: entries.map(([reference, value]) => `${reference}: ${value.excerpts.join(" | ")}`).join(" || ").slice(0, 900), reasoning_summary: "Fontes locais autoritativas apresentam referências diferentes; nenhuma foi escolhida silenciosamente.", status: "CONFLICT" };
  }
  const single = [...explicit.entries()][0];
  if (single) {
    const [reference, evidence] = single;
    const corroborated = evidence.ids.length >= 2;
    return { song_slug: item.song_slug, reel_id: item.reel_id, suggested_reference: reference, resolution_type: corroborated ? "SUGGESTED_CORROBORATED" : "SUGGESTED_EXPLICIT", confidence: "HIGH", evidence_source_record_ids: evidence.ids, evidence_excerpt_safe: evidence.excerpts.join(" | ").slice(0, 900), reasoning_summary: corroborated ? "A mesma referência aparece em múltiplas fontes locais autoritativas." : "Uma fonte local autoritativa contém uma citação explícita; a sugestão ainda requer verificação humana.", status: "AI_SUGGESTED" };
  }

  const narrativeSources = authoritative.filter((row) => ["SONG_LYRICS", "SONG_CREATION_PROMPT", "SUNO_PROMPT", "PROJECT_DOCUMENTATION"].includes(text(row.source_type)));
  for (const row of narrativeSources) {
    const excerpt = text(sourceMetadata(row).evidence_excerpt_safe);
    const normalized = normalize(excerpt);
    const narrative = normalized.includes("mar vermelho") || normalized.includes("mar se abriu") || normalized.includes("aguas se abriram") || normalized.includes("travessia do mar vermelho");
    if (narrative) return { song_slug: item.song_slug, reel_id: item.reel_id, suggested_reference: "Êxodo 14", resolution_type: "SUGGESTED_NARRATIVE", confidence: "MEDIUM", evidence_source_record_ids: [text(row.source_record_id)], evidence_excerpt_safe: excerpt.slice(0, 900), reasoning_summary: "A fonte criativa descreve explicitamente a travessia do Mar Vermelho; a passagem ampla é sugerida sem inventar versículos.", status: "AI_SUGGESTED" };
  }
  return { song_slug: item.song_slug, reel_id: item.reel_id, suggested_reference: null, resolution_type: "INSUFFICIENT", confidence: "LOW", evidence_source_record_ids: [], evidence_excerpt_safe: "", reasoning_summary: "Há metadados de catálogo e mídia, mas não foi encontrada letra, prompt ou referência bíblica autoritativa suficiente. Título e coleção não são tratados como prova.", status: "INSUFFICIENT_EVIDENCE" };
}

/** Read-only evidence resolver. It never mutates human verification state. */
export class BiblicalEvidenceResolver {
  constructor(private readonly db: ReturnType<typeof openDatabase>) {}
  resolve(item: ReviewItem): Resolution {
    const rows = this.db.prepare("SELECT * FROM song_source_registry WHERE song_slug = ? ORDER BY source_type, source_location").all(item.song_slug) as Row[];
    return resolveFromRows(item, rows);
  }
}

function persist(db: ReturnType<typeof openDatabase>, resolution: Resolution): void {
  const parsed = parseCanonicalReference(resolution.suggested_reference);
  const timestamp = now();
  db.prepare(`INSERT INTO biblical_resolution_suggestions (resolution_id, song_slug, reel_id, suggested_reference, book, chapter, verse_start, verse_end, display_reference, resolution_type, confidence, evidence_source_record_ids_json, evidence_excerpt_safe, reasoning_summary, status, resolver_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(song_slug, reel_id, resolver_version) DO UPDATE SET suggested_reference=excluded.suggested_reference, book=excluded.book, chapter=excluded.chapter, verse_start=excluded.verse_start, verse_end=excluded.verse_end, display_reference=excluded.display_reference, resolution_type=excluded.resolution_type, confidence=excluded.confidence, evidence_source_record_ids_json=excluded.evidence_source_record_ids_json, evidence_excerpt_safe=excluded.evidence_excerpt_safe, reasoning_summary=excluded.reasoning_summary, status=excluded.status, updated_at=excluded.updated_at`).run(
    stableId(`${resolution.song_slug}:${resolution.reel_id}:${BIBLICAL_RESOLVER_VERSION}`), resolution.song_slug, resolution.reel_id, resolution.suggested_reference, parsed.book, parsed.chapter, parsed.verseStart, parsed.verseEnd, parsed.displayReference, resolution.resolution_type, resolution.confidence, JSON.stringify(resolution.evidence_source_record_ids), resolution.evidence_excerpt_safe, resolution.reasoning_summary, resolution.status, BIBLICAL_RESOLVER_VERSION, timestamp, timestamp,
  );
  db.prepare("INSERT OR IGNORE INTO publication_audit_events (event_id, entity_type, entity_id, event_type, actor, timestamp, metadata_json_safe) VALUES (?, ?, ?, ?, ?, ?, ?)").run(stableId(`bible-suggestion:${resolution.song_slug}:${resolution.reel_id}:${BIBLICAL_RESOLVER_VERSION}`), "REEL", resolution.reel_id, "AI_BIBLE_SUGGESTION_CREATED", "phase7.2-local-engine", timestamp, JSON.stringify({ resolver_version: BIBLICAL_RESOLVER_VERSION, resolution_type: resolution.resolution_type, confidence: resolution.confidence, status: resolution.status, evidence_source_record_ids: resolution.evidence_source_record_ids }));
  if (resolution.resolution_type !== "INSUFFICIENT") db.prepare("INSERT OR IGNORE INTO publication_audit_events (event_id, entity_type, entity_id, event_type, actor, timestamp, metadata_json_safe) VALUES (?, ?, ?, ?, ?, ?, ?)").run(stableId(`bible-resolved:${resolution.song_slug}:${resolution.reel_id}:${BIBLICAL_RESOLVER_VERSION}`), "REEL", resolution.reel_id, "BIBLE_REFERENCE_RESOLVED", "phase7.2-local-engine", timestamp, JSON.stringify({ resolver_version: BIBLICAL_RESOLVER_VERSION, resolution_type: resolution.resolution_type, reference: resolution.suggested_reference, status: resolution.status }));
}

export async function resolvePrimaryBibleEvidence(config: MediaConfig = loadConfig()): Promise<{ candidates: number; resolutions: Resolution[]; counts: Record<string, number>; report: Record<string, unknown> }> {
  const items = await listReviewItems("primary", {}, config);
  const db = openDatabase(config);
  const resolutions: Resolution[] = [];
  try {
    const resolver = new BiblicalEvidenceResolver(db);
    for (const item of items) {
      const resolution = resolver.resolve(item);
      persist(db, resolution);
      resolutions.push(resolution);
    }
    const counts = Object.fromEntries([...new Set(resolutions.map((row) => row.resolution_type))].map((type) => [type, resolutions.filter((row) => row.resolution_type === type).length]));
    const evidenceNeeded = resolutions.filter((row) => row.resolution_type === "INSUFFICIENT").map((row) => ({ song_slug: row.song_slug, reel_id: row.reel_id, missing: ["original lyrics", "creation prompt", "explicit Bible metadata"], status: "INSUFFICIENT_EVIDENCE" }));
    const report = { generated_at: now(), resolver_version: BIBLICAL_RESOLVER_VERSION, scope: "PRIMARY", candidates: resolutions.length, counts, resolutions, evidence_needed: evidenceNeeded };
    return { candidates: resolutions.length, resolutions, counts, report };
  } finally { db.close(); }
}

export async function writeBiblicalResolutionReport(config: MediaConfig = loadConfig()): Promise<{ jsonPath: string; htmlPath: string; candidates: number }> {
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  const result = await resolvePrimaryBibleEvidence(config);
  const jsonPath = path.join(config.reelsOutputRoot, "biblical-resolution-report.json");
  const htmlPath = path.join(config.reelsOutputRoot, "biblical-resolution-report.html");
  await fs.writeFile(jsonPath, `${JSON.stringify(result.report, null, 2)}\n`, "utf8");
  const escape = (value: unknown) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char));
  const rows = result.resolutions.map((row) => `<article><h2>${escape(row.song_slug)}</h2><p>${escape(row.resolution_type)} · ${escape(row.confidence)} · ${escape(row.suggested_reference || "Sem sugestão")}</p><p>${escape(row.reasoning_summary)}</p><blockquote>${escape(row.evidence_excerpt_safe || "Sem evidência textual local")}</blockquote><small>${escape(row.evidence_source_record_ids.join(", ") || "Nenhuma fonte autoritativa")}</small></article>`).join("\n");
  await fs.writeFile(htmlPath, `<!doctype html><meta charset="utf-8"><title>Vargen & Fé — Evidência bíblica</title><style>body{font:16px system-ui;background:#111;color:#eee;max-width:1100px;margin:24px auto;padding:0 16px}article{border:1px solid #444;border-radius:8px;padding:14px;margin:12px 0}blockquote{border-left:3px solid #a47c3d;padding-left:12px;color:#ccc}</style><h1>Resolução bíblica — requer verificação humana</h1>${rows}`, "utf8");
  return { jsonPath, htmlPath, candidates: result.candidates };
}

export type { Resolution as BiblicalResolution };
