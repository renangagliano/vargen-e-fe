import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { loadConfig, type MediaConfig } from "../config/index.js";
import {
  appendAuditEvent,
  candidatesForAsset,
  curationRows,
  derivedReelsForAsset,
  latestCuration,
  latestEditorialPackage,
  listAssets,
  mediaAnalysisByKey,
  openDatabase,
  saveCuration,
} from "../database/db.js";
import { loadSongCatalog } from "../matching/catalog.js";
import { resolveBibleReference } from "./bible.js";
import type {
  BibleReferenceStatus,
  CandidateCategory,
  CurationDecision,
  CurationQualityTier,
  EditorialPackage,
  MediaAnalysisReport,
  PortfolioStatus,
  ReelCuration,
  ReelCandidate,
  Seasonality,
  SongCatalogEntry,
} from "../shared/types.js";

export const CURATION_VERSION = "phase6.1-curation-v2";

type Row = Record<string, unknown>;

type WorkingCandidate = ReelCuration & {
  category: CandidateCategory;
  startTimeMs: number;
  endTimeMs: number;
  audioProfile: number[];
  songTitle: string;
  collection: string;
  sourceFilename: string;
  outputRelativePath: string;
  thumbnailRelativePath: string;
  durationMs: number;
  oldScore: number;
  reviewStatus: string;
  rightsStatus: string;
  editorialPackage: EditorialPackage | null;
};

export type CurationOptions = {
  assetIds?: string[];
  sample?: boolean;
  persist?: boolean;
};

export type CurationSummary = {
  curationVersion: string;
  sample: boolean;
  assetsEvaluated: number;
  candidatesEvaluated: number;
  statusCounts: Record<PortfolioStatus, number>;
  activeBySong: { zero: number; one: number; two: number; three: number };
  qualityTiers: Record<CurationQualityTier, { count: number; averageScore: number }>;
  bibleStatuses: Record<BibleReferenceStatus, number>;
  collectionDistribution: Record<string, { active: number; hold: number; rejected: number }>;
  sampleSongs: Array<{ song: string; collection: string; decisions: Array<{ rank: number; decision: CurationDecision; reason: string }> }>;
  sampleDiscriminative: boolean;
  elapsedMs: number;
};

function numberValue(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function rounded(value: number): number {
  return Math.round(clamp(value) * 100) / 100;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const stopWords = new Set(["a", "as", "o", "os", "e", "de", "do", "da", "dos", "das", "um", "uma", "para", "por", "com", "que", "se", "na", "no", "em", "é", "this", "uma"]);

function tokens(value: string): Set<string> {
  return new Set(normalizeText(value).split(/\s+/).filter((token) => token.length > 2 && !stopWords.has(token)));
}

export function textSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
}

export function calculateOverlapPercentage(left: Pick<ReelCandidate, "startTimeMs" | "endTimeMs">, right: Pick<ReelCandidate, "startTimeMs" | "endTimeMs">): number {
  const overlap = Math.max(0, Math.min(left.endTimeMs, right.endTimeMs) - Math.max(left.startTimeMs, right.startTimeMs));
  const shortest = Math.max(1, Math.min(left.endTimeMs - left.startTimeMs, right.endTimeMs - right.startTimeMs));
  return rounded((overlap / shortest) * 100);
}

export function qualityTierForScore(score: number): CurationQualityTier {
  if (score >= 80) return "TIER_A";
  if (score >= 68) return "TIER_B";
  if (score >= 55) return "TIER_C";
  if (score >= 40) return "TIER_D";
  return "TIER_REJECT";
}

function sampleAt(report: MediaAnalysisReport, timeMs: number): number {
  if (report.samples.length === 0) return 0;
  let closest = report.samples[0];
  for (const sample of report.samples) {
    if (Math.abs(sample.timeMs - timeMs) < Math.abs(closest.timeMs - timeMs)) closest = sample;
  }
  return closest.normalizedEnergy;
}

function samplesInWindow(report: MediaAnalysisReport, startMs: number, endMs: number) {
  const selected = report.samples.filter((sample) => sample.timeMs >= startMs && sample.timeMs < endMs);
  return selected.length > 0 ? selected : report.samples.filter((sample) => sample.timeMs >= Math.max(0, startMs - 1000) && sample.timeMs < endMs + 1000);
}

function audioQuality(report: MediaAnalysisReport, candidate: ReelCandidate): number {
  const samples = samplesInWindow(report, candidate.startTimeMs, candidate.endTimeMs);
  if (samples.length === 0) return 0;
  const energies = samples.map((sample) => sample.normalizedEnergy);
  const averageEnergy = average(energies);
  const peak = Math.max(...energies);
  const continuity = samples.filter((sample) => sample.rmsDb > -55).length / samples.length;
  const dynamic = clamp((Math.max(...energies) - Math.min(...energies)) * 100);
  return rounded(averageEnergy * 30 + peak * 20 + continuity * 35 + dynamic * 0.15);
}

function boundaryQuality(report: MediaAnalysisReport, candidate: ReelCandidate): number {
  const samples = samplesInWindow(report, candidate.startTimeMs, candidate.endTimeMs);
  if (samples.length === 0) return 0;
  const first = sampleAt(report, candidate.startTimeMs);
  const last = sampleAt(report, Math.max(candidate.startTimeMs, candidate.endTimeMs - 200));
  const inside = average(samples.map((sample) => sample.normalizedEnergy));
  const start = clamp(first * 65 + (first >= 0.15 ? 35 : 10));
  const end = clamp(last * 55 + (last >= 0.12 ? 45 : 12));
  const density = clamp(inside * 100);
  return rounded(start * 0.38 + end * 0.38 + density * 0.24);
}

function contentDensity(report: MediaAnalysisReport, candidate: ReelCandidate): number {
  const samples = samplesInWindow(report, candidate.startTimeMs, candidate.endTimeMs);
  if (samples.length === 0) return 0;
  const continuity = samples.filter((sample) => sample.rmsDb > -55).length / samples.length;
  const mean = average(samples.map((sample) => sample.normalizedEnergy));
  return rounded(mean * 68 + continuity * 32);
}

function audioProfile(report: MediaAnalysisReport, candidate: ReelCandidate): number[] {
  const samples = samplesInWindow(report, candidate.startTimeMs, candidate.endTimeMs);
  if (samples.length === 0) return [0, 0, 0, 0];
  return [0, 1, 2, 3].map((index) => {
    const start = Math.floor(samples.length * index / 4);
    const end = Math.max(start + 1, Math.floor(samples.length * (index + 1) / 4));
    return average(samples.slice(start, end).map((sample) => sample.normalizedEnergy));
  });
}

function technicalQuality(row: Row): number {
  const valid = String(row.validation_status) === "PASS";
  const format = Number(row.width) === 1080 && Number(row.height) === 1920;
  const codecs = String(row.video_codec).toLowerCase().includes("264") && String(row.audio_codec).toLowerCase().includes("aac");
  return valid && format && codecs && numberValue(row.file_size) > 0 ? 100 : 0;
}

function visualQuality(row: Row, report: MediaAnalysisReport): number {
  if (technicalQuality(row) === 0) return 0;
  // No face recognition or subjective visual inference: this is a conservative
  // composition/continuity proxy derived from validated output and scene data.
  const scenePenalty = Math.min(12, report.sceneChangeCount * 2);
  return rounded(78 - scenePenalty);
}

function legacyQuality(oldScore: number): number {
  return rounded((oldScore - 65) * (100 / 30));
}

function absoluteQuality(input: { audio: number; boundary: number; density: number; visual: number; technical: number; oldScore: number }): number {
  return rounded(input.audio * 0.28 + input.boundary * 0.22 + input.density * 0.18 + input.visual * 0.12 + input.technical * 0.12 + legacyQuality(input.oldScore) * 0.08);
}

function seasonality(collection: string, songTitle: string): { value: Seasonality; context: string | null } {
  if (collection === "7 Dias com Deus  Fé, Força e Superação") {
    return { value: "WEEKDAY_SPECIFIC", context: songTitle.split(" — ")[0] || null };
  }
  if (collection === "12 Meses com Deus") {
    return { value: "MONTH_SPECIFIC", context: songTitle.split(" — ").at(-1) ?? null };
  }
  if (["Advento", "Anunciação", "Domingo da Páscoa", "Domingo de Ramos e da Paixão", "Quaresma", "Solenidades", "Tempo do Natal", "Tempo Comum"].includes(collection)) {
    return { value: "LITURGICAL_SEASONAL", context: collection };
  }
  if (/devoc/i.test(collection)) return { value: "DEVOTIONAL", context: collection };
  return { value: "EVERGREEN", context: null };
}

function categoryDifference(left: CandidateCategory, right: CandidateCategory): number {
  return left === right ? 0 : 100;
}

function editorialText(packageValue: EditorialPackage | null): string {
  if (!packageValue) return "";
  return [packageValue.selected_hook, packageValue.caption, packageValue.cta, packageValue.cover_text, packageValue.content_pillar].join(" ");
}

function intervalDistance(left: Pick<ReelCandidate, "startTimeMs" | "endTimeMs">, right: Pick<ReelCandidate, "startTimeMs" | "endTimeMs">): number {
  if (left.endTimeMs < right.startTimeMs) return right.startTimeMs - left.endTimeMs;
  if (right.endTimeMs < left.startTimeMs) return left.startTimeMs - right.endTimeMs;
  return 0;
}

function incrementalValue(candidate: ReelCandidate, packageValue: EditorialPackage | null, retained: WorkingCandidate[], candidateProfile: number[]): { value: number; overlap: number; distance: number; separation: number; distinctiveness: number } {
  if (retained.length === 0) return { value: 100, overlap: 0, distance: 0, separation: 100, distinctiveness: 100 };
  const comparisons = retained.map((item) => {
    const overlap = calculateOverlapPercentage(candidate, item);
    const distance = intervalDistance(candidate, item);
    const separation = clamp(distance / 1000);
    const editorialSimilarity = textSimilarity(editorialText(packageValue), editorialText(item.editorialPackage));
    const temporalDistinctiveness = clamp(100 - overlap);
    const structuralDistinctiveness = categoryDifference(candidate.category, item.category);
    const audioSimilarity = average(candidateProfile.map((value, index) => 1 - Math.abs(value - (item.audioProfile[index] ?? 0))));
    const audioDistinctiveness = clamp((1 - audioSimilarity) * 100);
    const distinctiveness = clamp(temporalDistinctiveness * 0.45 + structuralDistinctiveness * 0.15 + (1 - editorialSimilarity) * 100 * 0.2 + audioDistinctiveness * 0.2);
    const value = clamp(temporalDistinctiveness * 0.36 + separation * 0.18 + structuralDistinctiveness * 0.15 + (1 - editorialSimilarity) * 100 * 0.16 + audioDistinctiveness * 0.15);
    return { value, overlap, distance, separation, distinctiveness };
  });
  return comparisons.reduce((best, current) => current.value < best.value ? current : best);
}

function candidateFromRow(row: Row): ReelCandidate {
  return {
    candidateId: String(row.candidate_id),
    sourceAssetId: String(row.source_asset_id),
    startTimeMs: numberValue(row.start_time_ms),
    endTimeMs: numberValue(row.end_time_ms),
    durationMs: numberValue(row.duration_ms),
    category: String(row.category) as CandidateCategory,
    score: numberValue(row.score),
    selectionReason: String(row.selection_reason ?? ""),
    status: String(row.status) as ReelCandidate["status"],
    fingerprint: String(row.fingerprint),
    confidence: row.candidate_confidence === null || row.candidate_confidence === undefined ? undefined : numberValue(row.candidate_confidence),
    scoreBreakdown: row.score_breakdown_json ? JSON.parse(String(row.score_breakdown_json)) as Record<string, number> : undefined,
    analysisVersion: row.analysis_version ? String(row.analysis_version) : undefined,
    configurationVersion: row.configuration_version ? String(row.configuration_version) : undefined,
  };
}

function sourceSong(row: Row, catalog: SongCatalogEntry[]): SongCatalogEntry | null {
  return catalog.find((entry) => entry.slug === String(row.song_slug)) ?? null;
}

function editorialValue(candidate: ReelCandidate, packageValue: EditorialPackage | null, boundary: number, density: number, distinctiveness: number): number {
  const purpose = candidate.category === "MAIN_CHORUS" ? 86 : candidate.category === "STORY_BUILD" ? 78 : 80;
  const editorialCompleteness = packageValue ? 100 : 0;
  return rounded(purpose * 0.2 + boundary * 0.2 + density * 0.2 + distinctiveness * 0.25 + editorialCompleteness * 0.15);
}

function classification(input: {
  rank: number;
  tier: CurationQualityTier;
  absolute: number;
  relative: number;
  distinctiveness: number;
  incremental: number;
  boundary: number;
  visual: number;
  technical: number;
  overlap: number;
}): { status: PortfolioStatus; decision: CurationDecision; reason: string; thirdJustification: string | null } {
  if (input.technical === 0) return { status: "REJECTED", decision: "REJECT_LOW_VALUE", reason: "Falha técnica herdada; não pode permanecer no portfólio editorial ativo.", thirdJustification: null };
  if (input.rank === 1) {
    if (input.absolute >= 55 && input.boundary >= 45) {
      return { status: "ACTIVE", decision: "KEEP_PRIMARY", reason: "Maior qualidade absoluta da música, com validação técnica e fronteiras aceitáveis.", thirdJustification: null };
    }
    return { status: "HOLD", decision: "HOLD", reason: "Primeiro candidato ranqueado, mas requer revisão humana por qualidade absoluta ou fronteiras insuficientes.", thirdJustification: null };
  }
  if (input.rank === 2) {
    if (input.tier !== "TIER_D" && input.tier !== "TIER_REJECT" && input.absolute >= 64 && input.incremental >= 56 && input.distinctiveness >= 52) {
      return { status: "ACTIVE", decision: "KEEP_SECONDARY", reason: "Retido como segundo corte porque agrega valor editorial e região temporal distinta do principal.", thirdJustification: null };
    }
    if (input.absolute >= 52 && input.incremental >= 34) {
      return { status: "HOLD", decision: "HOLD", reason: "Tem sinais de qualidade, mas o ganho incremental ainda não justifica ativação automática.", thirdJustification: null };
    }
    return { status: "REJECTED", decision: input.overlap >= 50 ? "REJECT_REDUNDANT" : "REJECT_LOW_VALUE", reason: input.overlap >= 50 ? "Redundante em relação ao candidato de maior prioridade." : "Valor absoluto ou incremental abaixo do limite editorial.", thirdJustification: null };
  }
  const exceptional = input.tier === "TIER_A" && input.absolute >= 82 && input.relative >= 80 && input.distinctiveness >= 80 && input.incremental >= 82 && input.overlap <= 20 && input.boundary >= 70 && input.visual >= 70;
  if (exceptional) {
    return {
      status: "ACTIVE",
      decision: "KEEP_EXCEPTIONAL_THIRD",
      reason: "Terceiro Reel excepcional: qualidade alta, baixa sobreposição e finalidade editorial materialmente distinta.",
      thirdJustification: "Passou simultaneamente pelos gates de qualidade absoluta, ranking relativo, distinção, valor incremental, baixa sobreposição, fronteiras e estabilidade visual.",
    };
  }
  if (input.absolute >= 58 && input.incremental >= 35 && input.distinctiveness >= 35) {
    return { status: "HOLD", decision: "HOLD", reason: "Candidato potencialmente útil, mas o gate estrito para um terceiro Reel não foi atendido.", thirdJustification: null };
  }
  return { status: "REJECTED", decision: input.overlap >= 50 ? "REJECT_REDUNDANT" : input.distinctiveness < 35 ? "REJECT_LOW_DISTINCTIVENESS" : "REJECT_LOW_VALUE", reason: input.overlap >= 50 ? "Sobreposição temporal excessiva com conteúdo de maior prioridade." : input.distinctiveness < 35 ? "Baixa distinção editorial em relação aos candidatos retidos." : "Não demonstrou valor suficiente para um terceiro corte.", thirdJustification: null };
}

function makeCuration(input: {
  candidate: ReelCandidate;
  derived: Row;
  asset: Row;
  song: SongCatalogEntry;
  analysis: MediaAnalysisReport;
  packageValue: EditorialPackage | null;
  rank: number;
  relative: number;
  incremental: ReturnType<typeof incrementalValue>;
}): WorkingCandidate {
  const audio = audioQuality(input.analysis, input.candidate);
  const boundary = boundaryQuality(input.analysis, input.candidate);
  const density = contentDensity(input.analysis, input.candidate);
  const technical = technicalQuality(input.derived);
  const visual = visualQuality(input.derived, input.analysis);
  const absolute = absoluteQuality({ audio, boundary, density, visual, technical, oldScore: input.candidate.score });
  const distinctiveness = rounded(input.incremental.distinctiveness);
  const editorial = editorialValue(input.candidate, input.packageValue, boundary, density, distinctiveness);
  const baseScore = absolute * 0.42 + input.relative * 0.1 + distinctiveness * 0.17 + editorial * 0.11 + input.incremental.value * 0.2;
  const redundancyPenalty = Math.max(0, 65 - distinctiveness) * 0.28 + Math.max(0, 60 - input.incremental.value) * 0.22 + input.incremental.overlap * 0.05;
  const curationScore = rounded(baseScore - redundancyPenalty);
  const tier = qualityTierForScore(curationScore);
  const decision = classification({
    rank: input.rank, tier, absolute, relative: input.relative, distinctiveness,
    incremental: input.incremental.value, boundary, visual, technical, overlap: input.incremental.overlap,
  });
  const season = seasonality(input.song.category, input.song.title);
  const bible = resolveBibleReference(input.packageValue ?? undefined);
  const now = new Date().toISOString();
  const reel = String(input.derived.reel_id);
  return {
    curation_id: CURATION_VERSION + "-" + reel,
    reel_id: reel,
    candidate_id: input.candidate.candidateId,
    source_asset_id: input.asset.asset_id ? String(input.asset.asset_id) : input.candidate.sourceAssetId,
    curation_version: CURATION_VERSION,
    absolute_quality_score: absolute,
    relative_song_score: input.relative,
    distinctiveness_score: distinctiveness,
    editorial_value_score: editorial,
    technical_quality_score: technical,
    boundary_quality_score: boundary,
    visual_quality_score: visual,
    audio_quality_score: audio,
    content_density_score: density,
    curation_score: curationScore,
    incremental_editorial_value: rounded(input.incremental.value),
    overlap_percentage: rounded(input.incremental.overlap),
    timestamp_distance_ms: rounded(input.incremental.distance),
    section_separation: rounded(input.incremental.separation),
    within_song_rank: input.rank,
    quality_tier: tier,
    portfolio_status: decision.status,
    curation_decision: decision.decision,
    curation_reason: decision.reason,
    third_reel_justification: decision.thirdJustification,
    bible_reference_status: bible.status,
    seasonality: season.value,
    calendar_context: season.context,
    created_at: now,
    curated_at: now,
    category: input.candidate.category,
    startTimeMs: input.candidate.startTimeMs,
    endTimeMs: input.candidate.endTimeMs,
    audioProfile: audioProfile(input.analysis, input.candidate),
    songTitle: input.song.title,
    collection: input.song.category,
    sourceFilename: String(input.asset.source_filename ?? ""),
    outputRelativePath: String(input.derived.output_relative_path ?? ""),
    thumbnailRelativePath: String(input.derived.thumbnail_relative_path ?? ""),
    durationMs: numberValue(input.derived.duration_ms, input.candidate.durationMs),
    oldScore: input.candidate.score,
    reviewStatus: input.packageValue?.review_status ?? "READY_FOR_HUMAN_REVIEW",
    rightsStatus: String(input.derived.rights_status ?? input.asset.rights_status ?? "RIGHTS_PENDING_CONFIRMATION"),
    editorialPackage: input.packageValue,
  };
}

async function evaluateAsset(db: DatabaseSync, config: MediaConfig, asset: Row, song: SongCatalogEntry): Promise<WorkingCandidate[]> {
  const checksum = String(asset.checksum_sha256);
  const report = mediaAnalysisByKey(db, String(asset.asset_id), checksum, config.analysisVersion);
  if (!report) throw new Error("ANALYSIS_CACHE_MISSING");
  const candidates = candidatesForAsset(db, String(asset.asset_id)).map(candidateFromRow);
  const derived = derivedReelsForAsset(db, String(asset.asset_id));
  const byCandidate = new Map(derived.map((row) => [String(row.candidate_id), row]));
  const base = candidates.map((candidate) => {
    const derivedRow = byCandidate.get(candidate.candidateId);
    if (!derivedRow) return null;
    return { candidate, derived: derivedRow, packageValue: latestEditorialPackage(db, String(derivedRow.reel_id)) ?? null };
  }).filter((item): item is { candidate: ReelCandidate; derived: Row; packageValue: EditorialPackage | null } => item !== null && String(item.derived.validation_status) === "PASS");
  const absoluteScores = base.map((item) => {
    const audio = audioQuality(report, item.candidate);
    const boundary = boundaryQuality(report, item.candidate);
    const density = contentDensity(report, item.candidate);
    const technical = technicalQuality(item.derived);
    const visual = visualQuality(item.derived, report);
    return absoluteQuality({ audio, boundary, density, visual, technical, oldScore: item.candidate.score });
  });
  const min = Math.min(...absoluteScores, 0);
  const max = Math.max(...absoluteScores, 1);
  const sorted = [...base].sort((left, right) => {
    const leftScore = absoluteQuality({ audio: audioQuality(report, left.candidate), boundary: boundaryQuality(report, left.candidate), density: contentDensity(report, left.candidate), visual: visualQuality(left.derived, report), technical: technicalQuality(left.derived), oldScore: left.candidate.score });
    const rightScore = absoluteQuality({ audio: audioQuality(report, right.candidate), boundary: boundaryQuality(report, right.candidate), density: contentDensity(report, right.candidate), visual: visualQuality(right.derived, report), technical: technicalQuality(right.derived), oldScore: right.candidate.score });
    return rightScore - leftScore || left.candidate.startTimeMs - right.candidate.startTimeMs;
  });
  const retained: WorkingCandidate[] = [];
  const results: WorkingCandidate[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const item = sorted[index];
    const absolute = absoluteScores[base.indexOf(item)];
    const relative = sorted.length === 1 ? 100 : rounded(50 + ((absolute - min) / Math.max(1, max - min)) * 50);
    const incremental = incrementalValue(item.candidate, item.packageValue, retained, audioProfile(report, item.candidate));
    const curation = makeCuration({ candidate: item.candidate, derived: item.derived, asset, song, analysis: report, packageValue: item.packageValue, rank: index + 1, relative, incremental });
    results.push(curation);
    if (curation.portfolio_status === "ACTIVE") retained.push(curation);
  }
  return results.sort((left, right) => left.within_song_rank - right.within_song_rank);
}

const calibrationTitles = [
  "A Minha Paz Vos Dou",
  "Domingo - Tudo esta completo",
  "Até Aqui Nos Sustentou — Fevereiro",
  "Alegria que Liberta",
  "A Melhor Parte",
];

async function selectedAssets(config: MediaConfig, options: CurationOptions, catalog: SongCatalogEntry[]): Promise<Array<{ asset: Row; song: SongCatalogEntry }>> {
  const db = openDatabase(config);
  try {
    const requested = options.assetIds ? new Set(options.assetIds) : null;
    let rows = listAssets(db).filter((row) => row.availability_status === "LOCAL_AVAILABLE" && row.match_status === "MATCHED" && row.confidence === "EXACT");
    if (requested) rows = rows.filter((row) => requested.has(String(row.asset_id)));
    if (options.sample) {
      const preferred = new Set(calibrationTitles.map((title) => normalizeText(title)));
      const exact = rows.filter((row) => {
        const song = sourceSong(row, catalog);
        return song ? preferred.has(normalizeText(song.title)) : false;
      });
      const selected = [...exact];
      const collections = new Set(selected.map((row) => sourceSong(row, catalog)?.category));
      for (const row of rows) {
        if (selected.length >= 5) break;
        const song = sourceSong(row, catalog);
        if (song && !selected.some((item) => String(item.asset_id) === String(row.asset_id)) && !collections.has(song.category)) {
          selected.push(row);
          collections.add(song.category);
        }
      }
      rows = selected.length >= 5 ? selected.slice(0, 5) : [...selected, ...rows.filter((row) => !selected.includes(row)).slice(0, Math.max(0, 5 - selected.length))];
    }
    return rows.map((asset) => {
      const song = sourceSong(asset, catalog);
      if (!song) throw new Error("SONG_CATALOG_MATCH_NOT_FOUND");
      return { asset, song };
    });
  } finally {
    db.close();
  }
}

async function persistGroups(config: MediaConfig, groups: Array<{ asset: Row; song: SongCatalogEntry; curations: WorkingCandidate[] }>): Promise<void> {
  const db = openDatabase(config);
  try {
    for (const group of groups) {
      for (const curation of group.curations) {
        const previous = latestCuration(db, curation.reel_id);
        saveCuration(db, curation);
        if (!previous || previous.curation_version !== CURATION_VERSION || previous.portfolio_status !== curation.portfolio_status || previous.curation_decision !== curation.curation_decision) {
          const base = curation.curation_id;
          const eventSuffix = curation.curated_at.replace(/[^0-9A-Za-z]/g, "");
          appendAuditEvent(db, {
            eventId: base + "-evaluated-" + eventSuffix,
            entityType: "reel",
            entityId: curation.reel_id,
            eventType: "CURATION_EVALUATED",
            actor: "curation-engine",
            metadataJsonSafe: JSON.stringify({ curation_version: CURATION_VERSION, quality_tier: curation.quality_tier, portfolio_status: curation.portfolio_status }),
          });
          appendAuditEvent(db, {
            eventId: base + "-" + curation.portfolio_status.toLowerCase() + "-" + eventSuffix,
            entityType: "reel",
            entityId: curation.reel_id,
            eventType: curation.portfolio_status === "ACTIVE" ? "CURATION_KEEP" : curation.portfolio_status === "HOLD" ? "CURATION_HOLD" : "CURATION_REJECT",
            actor: "curation-engine",
            metadataJsonSafe: JSON.stringify({ decision: curation.curation_decision, reason: curation.curation_reason }),
          });
          if (curation.bible_reference_status !== "VERIFIED") {
            appendAuditEvent(db, {
              eventId: base + "-bible-review-" + eventSuffix,
              entityType: "reel",
              entityId: curation.reel_id,
              eventType: "BIBLE_REFERENCE_REVIEW_REQUIRED",
              actor: "curation-engine",
              metadataJsonSafe: JSON.stringify({ status: curation.bible_reference_status }),
            });
          } else {
            appendAuditEvent(db, {
              eventId: base + "-bible-resolved-" + eventSuffix,
              entityType: "reel",
              entityId: curation.reel_id,
              eventType: "BIBLE_REFERENCE_RESOLVED",
              actor: "curation-engine",
              metadataJsonSafe: JSON.stringify({ status: "VERIFIED" }),
            });
          }
        }
      }
    }
  } finally {
    db.close();
  }
}

function emptyTierCounts(): Record<CurationQualityTier, { count: number; averageScore: number }> {
  return {
    TIER_A: { count: 0, averageScore: 0 },
    TIER_B: { count: 0, averageScore: 0 },
    TIER_C: { count: 0, averageScore: 0 },
    TIER_D: { count: 0, averageScore: 0 },
    TIER_REJECT: { count: 0, averageScore: 0 },
  };
}

function buildSummary(groups: Array<{ asset: Row; song: SongCatalogEntry; curations: WorkingCandidate[] }>, sample: boolean, elapsedMs: number): CurationSummary {
  const all = groups.flatMap((group) => group.curations);
  const statusCounts: Record<PortfolioStatus, number> = { ACTIVE: 0, HOLD: 0, REJECTED: 0 };
  const activeBySong = { zero: 0, one: 0, two: 0, three: 0 };
  const qualityTiers = emptyTierCounts();
  const bibleStatuses: Record<BibleReferenceStatus, number> = { VERIFIED: 0, INFERRED_REVIEW_REQUIRED: 0, MISSING: 0, CONFLICT: 0 };
  const collectionDistribution: Record<string, { active: number; hold: number; rejected: number }> = {};
  for (const group of groups) {
    let active = 0;
    for (const item of group.curations) {
      statusCounts[item.portfolio_status] += 1;
      if (item.portfolio_status === "ACTIVE") active += 1;
      bibleStatuses[item.bible_reference_status] += 1;
      const tier = qualityTiers[item.quality_tier];
      tier.count += 1;
      tier.averageScore += item.curation_score;
      const collection = collectionDistribution[group.song.category] ?? { active: 0, hold: 0, rejected: 0 };
      collection[item.portfolio_status === "ACTIVE" ? "active" : item.portfolio_status === "HOLD" ? "hold" : "rejected"] += 1;
      collectionDistribution[group.song.category] = collection;
    }
    if (active === 0) activeBySong.zero += 1;
    else if (active === 1) activeBySong.one += 1;
    else if (active === 2) activeBySong.two += 1;
    else activeBySong.three += 1;
  }
  for (const tier of Object.values(qualityTiers)) if (tier.count > 0) tier.averageScore = rounded(tier.averageScore / tier.count);
  const sampleSongs = groups.map((group) => ({
    song: group.song.title,
    collection: group.song.category,
    decisions: group.curations.map((item) => ({ rank: item.within_song_rank, decision: item.curation_decision, reason: item.curation_reason })),
  }));
  return {
    curationVersion: CURATION_VERSION,
    sample,
    assetsEvaluated: groups.length,
    candidatesEvaluated: all.length,
    statusCounts,
    activeBySong,
    qualityTiers,
    bibleStatuses,
    collectionDistribution,
    sampleSongs,
    sampleDiscriminative: groups.some((group) => group.curations.some((item) => item.portfolio_status !== "ACTIVE")),
    elapsedMs: Math.round(elapsedMs),
  };
}

export async function runCuration(options: CurationOptions = {}, config = loadConfig()): Promise<CurationSummary> {
  const started = Date.now();
  const catalog = await loadSongCatalog(config.repoRoot);
  const selected = await selectedAssets(config, options, catalog);
  const db = openDatabase(config);
  const groups: Array<{ asset: Row; song: SongCatalogEntry; curations: WorkingCandidate[] }> = [];
  try {
    for (const item of selected) {
      groups.push({ ...item, curations: await evaluateAsset(db, config, item.asset, item.song) });
    }
  } finally {
    db.close();
  }
  if (options.persist !== false) await persistGroups(config, groups);
  return buildSummary(groups, options.sample === true, Date.now() - started);
}

function htmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function relativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

export async function writeCurationManifest(config = loadConfig(), sample = false): Promise<{ jsonPath: string; htmlPath: string; candidates: number }> {
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  const catalog = await loadSongCatalog(config.repoRoot);
  const db = openDatabase(config);
  try {
    const assets = listAssets(db).filter((row) => row.availability_status === "LOCAL_AVAILABLE" && row.match_status === "MATCHED" && row.confidence === "EXACT");
    const wanted = sample ? new Set((await selectedAssets(config, { sample: true }, catalog)).map((item) => String(item.asset.asset_id))) : null;
    const items: Array<Record<string, unknown>> = [];
    for (const asset of assets) {
      if (wanted && !wanted.has(String(asset.asset_id))) continue;
      const song = sourceSong(asset, catalog);
      if (!song) continue;
      const curations = curationRows(db, CURATION_VERSION).filter((item) => item.source_asset_id === String(asset.asset_id));
      const derived = new Map(derivedReelsForAsset(db, String(asset.asset_id)).map((row) => [String(row.reel_id), row]));
      for (const curation of curations) {
        const reel = derived.get(curation.reel_id);
        if (!reel) continue;
        const editorial = latestEditorialPackage(db, curation.reel_id);
        items.push({
          song: song.title,
          collection: song.category,
          source_asset_id: curation.source_asset_id,
          source_filename: String(asset.source_filename ?? ""),
          reel_id: curation.reel_id,
          thumbnail: relativePath(String(reel.thumbnail_relative_path ?? "")),
          output: relativePath(String(reel.output_relative_path ?? "")),
          duration_ms: numberValue(reel.duration_ms),
          timestamp: (await metadataTimestamp(config, reel.output_relative_path)).timestamp,
          old_score: numberValue((await metadataTimestamp(config, reel.output_relative_path)).oldScore),
          curation_score: curation.curation_score,
          absolute_quality_score: curation.absolute_quality_score,
          relative_song_score: curation.relative_song_score,
          distinctiveness_score: curation.distinctiveness_score,
          incremental_editorial_value: curation.incremental_editorial_value,
          quality_tier: curation.quality_tier,
          within_song_rank: curation.within_song_rank,
          portfolio_status: curation.portfolio_status,
          curation_decision: curation.curation_decision,
          curation_reason: curation.curation_reason,
          third_reel_justification: curation.third_reel_justification,
          bible_reference_status: curation.bible_reference_status,
          rights_status: String(reel.rights_status ?? asset.rights_status ?? "RIGHTS_PENDING_CONFIRMATION"),
          review_status: editorial?.review_status ?? "READY_FOR_HUMAN_REVIEW",
          selected_hook: editorial?.selected_hook ?? null,
          bible_reference: editorial?.bible_reference ?? null,
          seasonality: curation.seasonality,
          calendar_context: curation.calendar_context,
        });
      }
    }
    items.sort((left, right) => String(left.song).localeCompare(String(right.song), "pt-BR") || numberValue(left.within_song_rank) - numberValue(right.within_song_rank));
    const prefix = sample ? "catalog-curation-sample" : "catalog-curation";
    const jsonPath = path.join(config.reelsOutputRoot, prefix + ".json");
    const htmlPath = path.join(config.reelsOutputRoot, prefix + ".html");
    const grouped = new Map<string, Array<Record<string, unknown>>>();
    for (const item of items) {
      const key = String(item.song);
      const values = grouped.get(key) ?? [];
      values.push(item);
      grouped.set(key, values);
    }
    const songs = [...grouped.entries()].map(([song, candidates]) => ({
      song,
      collection: String(candidates[0]?.collection ?? ""),
      source_asset_id: String(candidates[0]?.source_asset_id ?? ""),
      candidate_count: candidates.length,
      rank_1: candidates.find((item) => numberValue(item.within_song_rank) === 1) ?? null,
      rank_2: candidates.find((item) => numberValue(item.within_song_rank) === 2) ?? null,
      rank_3: candidates.find((item) => numberValue(item.within_song_rank) === 3) ?? null,
    }));
    const manifest = { generated_at: new Date().toISOString(), curation_version: CURATION_VERSION, songs, candidates: items };
    await fs.writeFile(jsonPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    const rowsHtml = items.map((item) => "<article class=\"card\" data-status=\"" + htmlEscape(String(item.portfolio_status)) + "\" data-tier=\"" + htmlEscape(String(item.quality_tier)) + "\" data-collection=\"" + htmlEscape(String(item.collection)) + "\" data-bible=\"" + htmlEscape(String(item.bible_reference_status)) + "\"><img src=\"" + htmlEscape("./" + String(item.thumbnail)) + "\" alt=\"\"><div><h2>" + htmlEscape(String(item.song)) + " — R" + item.within_song_rank + "</h2><p><b>" + htmlEscape(String(item.portfolio_status)) + "</b> · " + htmlEscape(String(item.quality_tier)) + " · score " + item.curation_score + "</p><p>" + htmlEscape(String(item.curation_decision)) + ": " + htmlEscape(String(item.curation_reason)) + "</p><p>Diversidade " + item.distinctiveness_score + " · incremental " + item.incremental_editorial_value + " · Bíblia " + htmlEscape(String(item.bible_reference_status)) + " · direitos " + htmlEscape(String(item.rights_status)) + "</p><p><a href=\"" + htmlEscape("./" + String(item.output)) + "\">abrir Reel</a></p></div></article>").join("\n");
    const html = "<!doctype html><meta charset=\"utf-8\"><title>Vargen & Fé — Curadoria</title><style>body{font:16px system-ui;background:#111;color:#eee;max-width:1200px;margin:24px auto;padding:0 16px}.toolbar{display:flex;gap:8px;flex-wrap:wrap;position:sticky;top:0;background:#111;padding:12px 0}.card{display:grid;grid-template-columns:180px 1fr;gap:16px;border:1px solid #444;border-radius:10px;padding:12px;margin:12px 0;background:#1c1c1c}.card img{width:180px;height:320px;object-fit:cover;background:#000}.card a{color:#9bd1ff}@media(max-width:600px){.card{grid-template-columns:1fr}.card img{width:100%;height:auto}}</style><h1>Vargen & Fé — Curadoria " + (sample ? "amostra" : "catálogo") + "</h1><p>Versão " + CURATION_VERSION + ". Arquivo local; nada aqui publica conteúdo.</p><div class=\"toolbar\"><input id=\"q\" placeholder=\"Buscar música\"><select id=\"status\"><option value=\"\">Todos os status</option><option>ACTIVE</option><option>HOLD</option><option>REJECTED</option></select><select id=\"tier\"><option value=\"\">Todos os tiers</option><option>TIER_A</option><option>TIER_B</option><option>TIER_C</option><option>TIER_D</option><option>TIER_REJECT</option></select><select id=\"bible\"><option value=\"\">Todas as Bíblias</option><option>VERIFIED</option><option>MISSING</option><option>INFERRED_REVIEW_REQUIRED</option><option>CONFLICT</option></select></div><main id=\"cards\">" + rowsHtml + "</main><script>const q=document.querySelector('#q'),s=document.querySelector('#status'),t=document.querySelector('#tier'),b=document.querySelector('#bible');function f(){const v=q.value.toLowerCase();document.querySelectorAll('.card').forEach(c=>c.hidden=Boolean(v&&!c.textContent.toLowerCase().includes(v))||Boolean(s.value&&c.dataset.status!==s.value)||Boolean(t.value&&c.dataset.tier!==t.value)||Boolean(b.value&&c.dataset.bible!==b.value))} [q,s,t,b].forEach(x=>x.addEventListener('input',f));</script>";
    await fs.writeFile(htmlPath, html, "utf8");
    return { jsonPath, htmlPath, candidates: items.length };
  } finally {
    db.close();
  }
}

async function metadataTimestamp(config: MediaConfig, outputRelativePath: unknown): Promise<{ timestamp: string | null; oldScore: number | null }> {
  if (!config.reelsOutputRoot || !outputRelativePath) return { timestamp: null, oldScore: null };
  const metadataPath = path.join(config.reelsOutputRoot, String(outputRelativePath).replace(/\.mp4$/i, ".metadata.json"));
  try {
    const value = JSON.parse(await fs.readFile(metadataPath, "utf8")) as Record<string, unknown>;
    return { timestamp: String(value.generation_timestamp ?? null), oldScore: value.clip_score === undefined ? null : numberValue(value.clip_score) };
  } catch {
    return { timestamp: null, oldScore: null };
  }
}

export async function curationStatus(config = loadConfig()): Promise<Record<string, number>> {
  const db = openDatabase(config);
  try {
    const rows = curationRows(db, CURATION_VERSION);
    return {
      candidates: rows.length,
      active: rows.filter((row) => row.portfolio_status === "ACTIVE").length,
      hold: rows.filter((row) => row.portfolio_status === "HOLD").length,
      rejected: rows.filter((row) => row.portfolio_status === "REJECTED").length,
    };
  } finally {
    db.close();
  }
}
