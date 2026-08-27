import { createHash } from "node:crypto";
import type { AudioEnergySample, CandidateCategory, MediaAnalysisReport, ReelCandidate } from "../shared/types.js";

const PROCESSING_VERSION = "phase3-heuristic-v1";

type WindowStats = {
  average: number;
  peak: number;
  firstQuarter: number;
  lastQuarter: number;
  continuity: number;
  silenceFraction: number;
  rising: number;
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function candidateFingerprint(sourceAssetId: string, startTimeMs: number, endTimeMs: number): string {
  return `${sourceAssetId}:${startTimeMs}:${endTimeMs}:${PROCESSING_VERSION}`;
}

export function candidateId(sourceAssetId: string, startTimeMs: number, endTimeMs: number): string {
  return `candidate-${hash(candidateFingerprint(sourceAssetId, startTimeMs, endTimeMs))}`;
}

export function catalogCandidateFingerprint(sourceAssetId: string, startTimeMs: number, endTimeMs: number, analysisVersion: string, configurationVersion: string): string {
  return `${sourceAssetId}:${startTimeMs}:${endTimeMs}:${analysisVersion}:${configurationVersion}`;
}

function catalogCandidateId(fingerprint: string): string {
  return `candidate-${hash(fingerprint)}`;
}

export function reelId(candidate: ReelCandidate): string {
  return `reel-${hash(candidate.fingerprint)}`;
}

function samplesForWindow(samples: AudioEnergySample[], startMs: number, endMs: number): AudioEnergySample[] {
  return samples.filter((sample) => sample.timeMs >= startMs && sample.timeMs < endMs);
}

function average(samples: AudioEnergySample[]): number {
  return samples.length === 0 ? 0 : samples.reduce((total, sample) => total + sample.normalizedEnergy, 0) / samples.length;
}

function statsForWindow(samples: AudioEnergySample[], startMs: number, endMs: number): WindowStats {
  const selected = samplesForWindow(samples, startMs, endMs);
  if (selected.length === 0) return { average: 0, peak: 0, firstQuarter: 0, lastQuarter: 0, continuity: 0, silenceFraction: 1, rising: 0 };
  const quarter = Math.max(1, Math.floor(selected.length / 4));
  const firstQuarter = average(selected.slice(0, quarter));
  const lastQuarter = average(selected.slice(-quarter));
  const silenceFraction = selected.filter((sample) => sample.rmsDb <= -55).length / selected.length;
  return {
    average: average(selected),
    peak: Math.max(...selected.map((sample) => sample.normalizedEnergy)),
    firstQuarter,
    lastQuarter,
    continuity: 1 - silenceFraction,
    silenceFraction,
    rising: lastQuarter - firstQuarter,
  };
}

function overlapRatio(left: ReelCandidate, right: { startTimeMs: number; endTimeMs: number }): number {
  const overlap = Math.max(0, Math.min(left.endTimeMs, right.endTimeMs) - Math.max(left.startTimeMs, right.startTimeMs));
  return overlap / Math.min(left.durationMs, right.endTimeMs - right.startTimeMs);
}

export function candidateOverlapRatio(left: ReelCandidate, right: ReelCandidate): number {
  return overlapRatio(left, right);
}

function scoreWindow(stats: WindowStats, category: CandidateCategory): number {
  const sectionCompleteness = stats.continuity;
  const hookStrength = stats.peak * 0.45 + stats.average * 0.55;
  const build = Math.max(0, Math.min(1, 0.5 + stats.rising));
  const categoryBonus = category === "STORY_BUILD" ? build * 0.25 : category === "LYRICAL_HOOK" ? hookStrength * 0.2 : stats.average * 0.12;
  const score = hookStrength * 45 + sectionCompleteness * 25 + stats.peak * 15 + categoryBonus * 15 - stats.silenceFraction * 35;
  return Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
}

function reason(stats: WindowStats, category: CandidateCategory, durationMs: number, sceneChangeCount: number): string {
  const energy = Math.round(stats.average * 100);
  const peak = Math.round(stats.peak * 100);
  const build = Math.round(Math.max(0, stats.rising) * 100);
  return `${category} heurístico de ${Math.round(durationMs / 1000)}s: energia média ${energy}/100, pico ${peak}/100, continuidade ${Math.round(stats.continuity * 100)}%${category === "STORY_BUILD" ? `, crescimento de energia ${build}/100` : ""}. ${sceneChangeCount} mudanças de cena detectadas no arquivo; sem alinhamento confiável de letras.`;
}

function bestForDuration(report: MediaAnalysisReport, durationMs: number, category: CandidateCategory, selected: ReelCandidate[], overlapLimit = 0.5, identity?: { analysisVersion: string; configurationVersion: string }): ReelCandidate {
  const lastStart = Math.max(0, report.durationMs - durationMs);
  let best: ReelCandidate | null = null;
  for (let start = 0; start <= lastStart; start += 500) {
    const end = start + durationMs;
    const stats = statsForWindow(report.samples, start, end);
    const fingerprint = identity ? catalogCandidateFingerprint(report.sourceAssetId, start, end, identity.analysisVersion, identity.configurationVersion) : candidateFingerprint(report.sourceAssetId, start, end);
    const candidate: ReelCandidate = {
      candidateId: identity ? catalogCandidateId(fingerprint) : candidateId(report.sourceAssetId, start, end),
      sourceAssetId: report.sourceAssetId,
      startTimeMs: start,
      endTimeMs: end,
      durationMs,
      category,
      score: scoreWindow(stats, category),
      selectionReason: reason(stats, category, durationMs, report.sceneChangeCount),
      status: "PROPOSED",
      fingerprint,
      confidence: Math.round((scoreWindow(stats, category) / 100) * 1000) / 1000,
      scoreBreakdown: {
        audio_energy_score: Math.round(stats.average * 100),
        peak_score: Math.round(stats.peak * 100),
        continuity_score: Math.round(stats.continuity * 100),
        silence_penalty: Math.round(stats.silenceFraction * 100),
        dynamic_change_score: Math.round(Math.max(0, Math.min(1, 0.5 + stats.rising)) * 100),
      },
      analysisVersion: identity?.analysisVersion,
      configurationVersion: identity?.configurationVersion,
    };
    if (selected.some((existing) => overlapRatio(existing, candidate) > overlapLimit)) continue;
    if (!best || candidate.score > best.score) best = candidate;
  }
  if (best) return best;
  throw new Error(`NO_DISTINCT_CANDIDATE_AVAILABLE: ${category}`);
}

export function selectCandidates(report: MediaAnalysisReport): ReelCandidate[] {
  if (report.durationMs < 60000 || report.samples.length === 0) throw new Error("SOURCE_TOO_SHORT_OR_AUDIO_ANALYSIS_EMPTY");
  const selected: ReelCandidate[] = [];
  selected.push(bestForDuration(report, 18000, "LYRICAL_HOOK", selected));
  selected.push(bestForDuration(report, 30000, "MAIN_CHORUS", selected));
  selected.push(bestForDuration(report, 52000, "STORY_BUILD", selected));
  return selected;
}

export function selectCatalogCandidates(report: MediaAnalysisReport, options: { minScore: number; minConfidence: number; maxCandidates: number; maxOverlapPercent: number; analysisVersion: string; configurationVersion: string }): ReelCandidate[] {
  if (report.durationMs < 15000 || report.samples.length === 0 || options.maxCandidates <= 0) return [];
  const durationSpecs: Array<{ durationMs: number; category: CandidateCategory }> = [
    { durationMs: 18000, category: "LYRICAL_HOOK" as CandidateCategory },
    { durationMs: 30000, category: "MAIN_CHORUS" as CandidateCategory },
    { durationMs: 52000, category: "STORY_BUILD" as CandidateCategory },
  ].filter((spec) => report.durationMs >= spec.durationMs);
  const selected: ReelCandidate[] = [];
  const overlapLimit = Math.min(1, Math.max(0, options.maxOverlapPercent / 100));
  for (const spec of durationSpecs) {
    if (selected.length >= options.maxCandidates) break;
    let candidate: ReelCandidate;
    try {
      candidate = bestForDuration(report, spec.durationMs, spec.category, selected, overlapLimit, { analysisVersion: options.analysisVersion, configurationVersion: options.configurationVersion });
    } catch {
      continue;
    }
    const confidence = candidate.confidence ?? candidate.score / 100;
    if (candidate.score < options.minScore || confidence < options.minConfidence) continue;
    candidate.status = "SELECTED";
    candidate.decision = "SELECTED";
    candidate.selectionReason = `${candidate.selectionReason} Score mínimo ${options.minScore}; confiança heurística ${Math.round(confidence * 100)}%.`;
    selected.push(candidate);
  }
  return selected;
}

export { PROCESSING_VERSION };
