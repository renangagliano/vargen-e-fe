import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { MediaConfig } from "../config/index.js";

export type KnowledgeBaseEntry = {
  song_id: string;
  slug: string;
  title: string;
  collection: string;
  liturgical_season: string;
  liturgical_year: string;
  core_message: string;
  summary: string;
  primary_theme: string;
  secondary_themes: string[];
  primary_bible_reference: string;
  secondary_bible_references: string[];
  biblical_story: string;
  biblical_characters: string[];
  liturgical_context: string;
  calendar_context: string;
  editorial_keywords: string[];
  historical_context: string;
  evidence_level: string;
  confidence: string;
  verification_status: string;
  provenance: Record<string, unknown>;
};

export type KnowledgeBaseCatalog = {
  schema_version: string;
  generated_at: string;
  purpose: string;
  record_count: number;
  songs: KnowledgeBaseEntry[];
};

export const KNOWLEDGE_BASE_RELATIVE_PATH = "src/data/knowledge-base/vargen-fe-knowledge-base-master.json";

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }

function normalizeEntry(value: unknown): KnowledgeBaseEntry {
  const row = (value && typeof value === "object") ? value as Record<string, unknown> : {};
  return {
    song_id: stringValue(row.song_id), slug: stringValue(row.slug), title: stringValue(row.title), collection: stringValue(row.collection),
    liturgical_season: stringValue(row.liturgical_season), liturgical_year: stringValue(row.liturgical_year), core_message: stringValue(row.core_message),
    summary: stringValue(row.summary), primary_theme: stringValue(row.primary_theme), secondary_themes: arrayOfStrings(row.secondary_themes),
    primary_bible_reference: stringValue(row.primary_bible_reference), secondary_bible_references: arrayOfStrings(row.secondary_bible_references),
    biblical_story: stringValue(row.biblical_story), biblical_characters: arrayOfStrings(row.biblical_characters), liturgical_context: stringValue(row.liturgical_context),
    calendar_context: stringValue(row.calendar_context), editorial_keywords: arrayOfStrings(row.editorial_keywords), historical_context: stringValue(row.historical_context),
    evidence_level: stringValue(row.evidence_level), confidence: stringValue(row.confidence), verification_status: stringValue(row.verification_status),
    provenance: row.provenance && typeof row.provenance === "object" ? row.provenance as Record<string, unknown> : {},
  };
}

export async function loadKnowledgeBase(configOrRoot: MediaConfig | string): Promise<{ catalog: KnowledgeBaseCatalog; bySlug: Map<string, KnowledgeBaseEntry>; contentHash: string }> {
  const repoRoot = typeof configOrRoot === "string" ? configOrRoot : configOrRoot.repoRoot;
  const filePath = path.join(repoRoot, KNOWLEDGE_BASE_RELATIVE_PATH);
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const songs = Array.isArray(parsed.songs) ? parsed.songs.map(normalizeEntry) : [];
  const recordCount = Number(parsed.record_count);
  if (!Number.isInteger(recordCount) || recordCount !== songs.length) throw new Error("KNOWLEDGE_BASE_RECORD_COUNT_INVALID");
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const song of songs) {
    if (!song.song_id || !song.slug || !song.title) throw new Error("KNOWLEDGE_BASE_REQUIRED_FIELD_MISSING");
    if (ids.has(song.song_id) || slugs.has(song.slug)) throw new Error("KNOWLEDGE_BASE_DUPLICATE_ID_OR_SLUG");
    ids.add(song.song_id); slugs.add(song.slug);
  }
  const catalog: KnowledgeBaseCatalog = { schema_version: stringValue(parsed.schema_version), generated_at: stringValue(parsed.generated_at), purpose: stringValue(parsed.purpose), record_count: recordCount, songs };
  return { catalog, bySlug: new Map(songs.map((song) => [song.slug, song])), contentHash: createHash("sha256").update(raw, "utf8").digest("hex") };
}

export function knowledgeContext(entry: KnowledgeBaseEntry | undefined): Record<string, unknown> | null {
  if (!entry) return null;
  return { ...entry };
}
