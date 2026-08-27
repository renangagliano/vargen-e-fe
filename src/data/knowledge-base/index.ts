import rawCatalog from "./vargen-fe-knowledge-base-master.json";
import { songs } from "@/data/songs";
import { validateKnowledgeBaseCatalog } from "./validation";
import type { KnowledgeBaseCatalog, KnowledgeBaseIntegrityReport, KnowledgeBaseSong } from "./types";

export type { KnowledgeBaseCatalog, KnowledgeBaseIntegrityReport, KnowledgeBasePolicy, KnowledgeBaseProvenance, KnowledgeBaseSong, KnowledgeConfidence, KnowledgeEvidenceLevel, KnowledgeVerificationStatus } from "./types";

const catalog: KnowledgeBaseCatalog = validateKnowledgeBaseCatalog(rawCatalog);
const entriesBySlug = new Map(catalog.songs.map((entry) => [entry.slug, entry]));

export function getKnowledgeBaseEntries(): readonly KnowledgeBaseSong[] {
  return catalog.songs;
}

export function getKnowledgeBaseEntry(songSlug: string): KnowledgeBaseSong | undefined {
  return entriesBySlug.get(songSlug);
}

export function getKnowledgeBaseByCollection(collection: string): KnowledgeBaseSong[] {
  return catalog.songs.filter((entry) => entry.collection === collection);
}

export function getKnowledgeBaseByTheme(theme: string): KnowledgeBaseSong[] {
  const normalized = theme.trim().toLocaleLowerCase("pt-BR");
  return catalog.songs.filter((entry) => [entry.primary_theme, ...entry.secondary_themes].some((item) => item.toLocaleLowerCase("pt-BR") === normalized));
}

export function getEntriesRequiringEditorialReview(): KnowledgeBaseSong[] {
  return catalog.songs.filter((entry) => entry.verification_status !== "VERIFIED");
}

export function getKnowledgeBaseSearchText(entry: KnowledgeBaseSong): string {
  return [entry.title, entry.collection, entry.primary_theme, ...entry.secondary_themes, ...entry.editorial_keywords, entry.primary_bible_reference, ...entry.secondary_bible_references, entry.biblical_story, entry.liturgical_context, entry.calendar_context].filter(Boolean).join(" ");
}

export function getKnowledgeBaseIntegrityReport(): KnowledgeBaseIntegrityReport {
  const catalogSlugs = new Set(songs.map((song) => song.slug));
  const knowledgeSlugs = new Set(catalog.songs.map((entry) => entry.slug));
  const duplicateSongIds = catalog.songs.map((entry) => entry.song_id).filter((value, index, values) => values.indexOf(value) !== index).filter((value, index, values) => values.indexOf(value) === index);
  const duplicateSlugs = catalog.songs.map((entry) => entry.slug).filter((value, index, values) => values.indexOf(value) !== index).filter((value, index, values) => values.indexOf(value) === index);
  const knowledgeBaseSlugsWithoutSong = catalog.songs.filter((entry) => !catalogSlugs.has(entry.slug)).map((entry) => entry.slug);
  const songsWithoutKnowledgeBase = songs.filter((song) => !knowledgeSlugs.has(song.slug)).map((song) => song.slug);
  return {
    recordCount: catalog.songs.length,
    expectedRecordCount: 79,
    catalogSongCount: songs.length,
    matchedSlugs: catalog.songs.filter((entry) => catalogSlugs.has(entry.slug)).length,
    knowledgeBaseSlugsWithoutSong,
    songsWithoutKnowledgeBase,
    duplicateSongIds,
    duplicateSlugs,
    isValid: catalog.songs.length === 79 && songs.length === 79 && knowledgeBaseSlugsWithoutSong.length === 0 && songsWithoutKnowledgeBase.length === 0 && duplicateSongIds.length === 0 && duplicateSlugs.length === 0,
  };
}

export const knowledgeBaseCatalog = catalog;
