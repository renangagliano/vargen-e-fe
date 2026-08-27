import { textSimilarity } from "../curation/engine.js";
import type { EditorialPackage, AiBibleConfidence, AiBibleSuggestion, AiDuplicateRisk, AiEditorialSuggestion, AiRecommendation, AiReviewResult } from "../shared/types.js";
import type { ReviewItem } from "../review/service.js";

export const AI_REVIEW_VERSION = "phase7.1-local-v1";
export const AI_ENGINE_VERSION = "deterministic-local-content-intelligence-v1";
export const AI_PROVIDER_NAME = "DeterministicLocalProvider";

export type AiCorpusItem = Pick<ReviewItem, "reel_id" | "song_title" | "collection" | "editorial" | "source_asset_id" | "start_time_ms" | "end_time_ms" | "curation">;

export type AiEvaluation = {
  review: Omit<AiReviewResult, "review_priority_score" | "review_priority_rank">;
  bible: Omit<AiBibleSuggestion, "suggestion_id">;
  editorial: Omit<AiEditorialSuggestion, "suggestion_id">;
};

export interface ContentIntelligenceProvider {
  readonly name: string;
  readonly engineVersion: string;
  evaluate(item: ReviewItem, corpus: AiCorpusItem[]): AiEvaluation;
}

const CLICKBAIT_PATTERNS = [
  /garante/i, /milagre certo/i, /vai ficar rico/i, /dinheiro/i,
  /compartilhe.{0,20}(receba|bênção|bencao)/i, /comente.{0,20}(amen|glória)/i,
  /se você não/i, /última chance/i,
];
const SAFE_CTA_FALLBACKS = ["Salve para ouvir novamente.", "Compartilhe com alguém que precisa seguir em frente.", "Qual trecho falou com você?"];

function clamp(value: number): number { return Math.max(0, Math.min(100, Math.round(value * 100) / 100)); }
function words(value: string): string[] { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2); }
function hasBrand(value: string): boolean { return /vargen\s*&\s*f[eé]/iu.test(value) || /a bíblia transformada em música/i.test(value); }
function distinct(values: string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
function firstParagraph(value: string): string { return value.split(/\n\s*\n/)[0]?.trim() ?? value.trim(); }
function parseReference(reference: string | null): { book: string | null; chapter: number | null; verseRange: string | null } {
  if (!reference) return { book: null, chapter: null, verseRange: null };
  const match = reference.match(/^(.*)\s+(\d+)(?:,(.+))?$/u);
  return { book: match?.[1] ?? reference, chapter: match ? Number(match[2]) : null, verseRange: match?.[3] ?? null };
}
function riskLevel(value: number): AiDuplicateRisk { return value >= 70 ? "HIGH" : value >= 40 ? "MEDIUM" : "LOW"; }
function similarCandidates(item: AiCorpusItem, corpus: AiCorpusItem[]): { risk: AiDuplicateRisk; related: string[]; score: number } {
  const current = item.editorial;
  if (!current) return { risk: "MEDIUM", related: [], score: 50 };
  const matches = corpus.filter((other) => other.reel_id !== item.reel_id).map((other) => {
    const editorial = other.editorial;
    if (!editorial) return { id: other.reel_id, score: 0 };
    const hook = textSimilarity(current.selected_hook, editorial.selected_hook);
    const caption = textSimilarity(firstParagraph(current.caption), firstParagraph(editorial.caption));
    const cta = textSimilarity(current.cta, editorial.cta);
    const cover = textSimilarity(current.cover_text, editorial.cover_text);
    const sameSource = other.source_asset_id === item.source_asset_id;
    const temporalOverlap = sameSource && Math.max(0, Math.min(item.end_time_ms, other.end_time_ms) - Math.max(item.start_time_ms, other.start_time_ms)) > 0;
    return { id: other.reel_id, score: Math.min(100, (hook * 45 + caption * 25 + cta * 15 + cover * 15) + (sameSource ? 12 : 0) + (temporalOverlap ? 18 : 0)) };
  }).filter((match) => match.score >= 40).sort((a, b) => b.score - a.score);
  return { risk: riskLevel(matches[0]?.score ?? 0), related: matches.slice(0, 5).map((match) => match.id), score: matches[0]?.score ?? 0 };
}

function hookScore(value: string): number {
  const length = value.trim().length;
  if (!length) return 0;
  const lengthScore = length >= 25 && length <= 90 ? 100 : length < 25 ? 55 + length : Math.max(35, 100 - (length - 90) * 1.5);
  const rhythm = /[?!…]$/u.test(value.trim()) ? 8 : 0;
  const risk = CLICKBAIT_PATTERNS.some((pattern) => pattern.test(value)) ? 35 : 0;
  return clamp(lengthScore + rhythm - risk);
}
function captionScore(value: string): number {
  const length = value.trim().length;
  if (!length) return 0;
  const paragraphs = value.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean).length;
  const structure = paragraphs >= 3 && paragraphs <= 7 ? 100 : paragraphs === 2 || paragraphs === 8 ? 75 : 50;
  const concise = length <= 1000 ? 100 : Math.max(35, 100 - (length - 1000) / 15);
  const brand = hasBrand(value) ? 8 : -10;
  const engagement = /[?？]/u.test(value) ? 5 : 0;
  const risk = CLICKBAIT_PATTERNS.some((pattern) => pattern.test(value)) ? 35 : 0;
  return clamp(structure * 0.35 + concise * 0.35 + 40 + brand + engagement - risk);
}
function ctaScore(value: string): number { return clamp(value.trim().length >= 12 && value.trim().length <= 110 ? (CLICKBAIT_PATTERNS.some((pattern) => pattern.test(value)) ? 30 : 92) : 50); }
function hashtagScore(values: string[]): number {
  const tags = distinct(values);
  const contextual = tags.filter((tag) => /vargen|catolic|crist|bíblia|biblia|fé|fe|oração|oracao|supera|exodo|êxodo|deus|rock/iu.test(tag)).length;
  return clamp((tags.length >= 5 && tags.length <= 10 ? 78 : 52) + (tags.some((tag) => /#vargenef[eé]/iu.test(tag)) ? 15 : -8) + Math.min(12, contextual * 2) - Math.max(0, tags.length - 10) * 3);
}
function titleScore(value: string): number { const length = value.trim().length; return clamp(length >= 15 && length <= 90 ? 92 : length ? 60 : 0); }
function riskScore(value: string): number { return CLICKBAIT_PATTERNS.reduce((score, pattern) => score + (pattern.test(value) ? 35 : 0), 0); }
function safeSuggestedHook(editorial: EditorialPackage): string {
  const current = editorial.selected_hook.trim();
  if (current.length <= 90) return current;
  const shortened = current.slice(0, 87).replace(/\s+\S*$/u, "").trim();
  return `${shortened}…`;
}
function safeSuggestedCaption(editorial: EditorialPackage): string {
  if (editorial.caption.length <= 1000) return editorial.caption;
  const signature = "Vargen & Fé\nA Bíblia transformada em música.";
  return `${editorial.caption.slice(0, 900).replace(/\s+\S*$/u, "").trim()}…\n\n${signature}`;
}
function safeSuggestedHashtags(editorial: EditorialPackage): string[] { return distinct([...editorial.hashtags, "#VargenEFé"]).slice(0, 10); }

export class DeterministicLocalProvider implements ContentIntelligenceProvider {
  readonly name = AI_PROVIDER_NAME;
  readonly engineVersion = AI_ENGINE_VERSION;

  evaluate(item: ReviewItem, corpus: AiCorpusItem[]): AiEvaluation {
    const editorial = item.editorial;
    const hook = hookScore(editorial?.selected_hook ?? "");
    const caption = captionScore(editorial?.caption ?? "");
    const cta = ctaScore(editorial?.cta ?? "");
    const hashtags = hashtagScore(editorial?.hashtags ?? []);
    const title = titleScore(editorial?.editorial_title ?? "");
    const pillar = editorial?.content_pillar ? 90 : 20;
    const collection = item.collection === "REVIEW_REQUIRED" ? 35 : 90;
    const biblical = item.bible.status === "VERIFIED" ? 98 : item.bible.status === "CONFLICT" ? 10 : 42;
    const theologicalRisk = riskScore([editorial?.selected_hook ?? "", editorial?.caption ?? "", editorial?.cta ?? ""].join(" "));
    const duplicate = similarCandidates(item, corpus);
    const duplicatePenalty = duplicate.score * 0.4;
    const duration = item.duration_ms / 1000;
    const retention = clamp(hook * 0.45 + (duration >= 15 && duration <= 60 ? 82 : 52) * 0.25 + item.curation.distinctiveness * 0.2 + item.curation.score * 0.1 - duplicatePenalty * 0.25);
    const clarity = clamp(hook * 0.3 + caption * 0.4 + title * 0.3);
    const emotion = clamp(item.curation.score * 0.55 + item.curation.incremental_value * 0.45);
    const authenticity = clamp((hasBrand(editorial?.caption ?? "") ? 35 : 20) + (editorial?.content_pillar ? 35 : 0) + biblical * 0.3);
    const clickbaitRisk = riskScore([editorial?.selected_hook ?? "", editorial?.caption ?? "", editorial?.cta ?? ""].join(" "));
    const editorialQuality = clamp(hook * 0.16 + caption * 0.18 + cta * 0.1 + hashtags * 0.08 + title * 0.1 + pillar * 0.08 + collection * 0.05 + clarity * 0.1 + authenticity * 0.15);
    const overall = clamp(editorialQuality * 0.35 + retention * 0.2 + emotion * 0.15 + authenticity * 0.1 + biblical * 0.1 + clarity * 0.1 - theologicalRisk * 0.2 - duplicatePenalty * 0.15);
    const recommendation: AiRecommendation = theologicalRisk >= 70 || overall < 45 ? "RECOMMEND_REJECT" : overall >= 82 && item.bible.status === "VERIFIED" && theologicalRisk < 20 && duplicate.risk === "LOW" ? "RECOMMEND_APPROVE" : overall < 65 || duplicate.risk === "HIGH" ? "RECOMMEND_CHANGES" : "HUMAN_REVIEW_REQUIRED";
    const summary = `Heurística local: qualidade editorial ${editorialQuality.toFixed(1)}, retenção ${retention.toFixed(1)}, Bíblia ${item.bible.status}, duplicação ${duplicate.risk}. Recomendações não alteram a revisão humana.`;
    const explicitReference = item.bible.reference;
    const parsed = parseReference(explicitReference);
    const bible: Omit<AiBibleSuggestion, "suggestion_id"> = {
      reel_id: item.reel_id, ai_review_version: AI_REVIEW_VERSION, reference: explicitReference, book: parsed.book, chapter: parsed.chapter, verse_range: parsed.verseRange,
      confidence: item.bible.status === "VERIFIED" ? "HIGH" : explicitReference ? "LOW" : "LOW",
      evidence_sources: item.bible.status === "VERIFIED" ? [item.bible.evidence] : [],
      reasoning_summary: item.bible.status === "VERIFIED" ? "Referência já verificada no fluxo humano existente; a IA apenas a apresenta como evidência." : "Não há referência bíblica estruturada verificável nas fontes locais; título e coleção não são suficientes para citar uma passagem.",
      status: item.bible.status === "VERIFIED" ? "HUMAN_VERIFIED" : "INSUFFICIENT_EVIDENCE",
      engine_version: this.engineVersion,
    };
    const suggestedPackage: Partial<EditorialPackage> = editorial ? {
      editorial_title: editorial.editorial_title.trim(), selected_hook: safeSuggestedHook(editorial), caption: safeSuggestedCaption(editorial), cta: CLICKBAIT_PATTERNS.some((pattern) => pattern.test(editorial.cta)) ? SAFE_CTA_FALLBACKS[item.curation.rank % SAFE_CTA_FALLBACKS.length] : editorial.cta,
      hashtags: safeSuggestedHashtags(editorial), content_pillar: editorial.content_pillar, secondary_pillar: editorial.secondary_pillar, cover_text: editorial.cover_text.trim().slice(0, 60),
    } : {};
    const changedFields = Object.keys(suggestedPackage).filter((field) => JSON.stringify((editorial as Record<string, unknown> | null)?.[field]) !== JSON.stringify(suggestedPackage[field as keyof EditorialPackage]));
    return {
      review: {
        reel_id: item.reel_id, ai_review_version: AI_REVIEW_VERSION, provider: this.name, ai_reviewed_at: new Date().toISOString(),
        editorial_quality_score: editorialQuality, hook_score: hook, caption_score: caption, cta_score: cta, hashtag_score: hashtags, title_score: title,
        pillar_consistency_score: pillar, collection_consistency_score: collection, biblical_consistency_score: biblical, theological_risk: theologicalRisk,
        duplicate_risk: duplicate.risk, retention_score: retention, clarity_score: clarity, emotional_impact_score: emotion, authenticity_score: authenticity,
        clickbait_risk: clickbaitRisk, overall_ai_score: overall, ai_recommendation: recommendation, ai_reasoning_summary: summary, related_reel_ids: duplicate.related, engine_version: this.engineVersion,
      },
      bible,
      editorial: { reel_id: item.reel_id, ai_review_version: AI_REVIEW_VERSION, base_editorial_version: editorial?.editorial_version ?? 0, suggested_package: suggestedPackage, changed_fields: changedFields, reasoning_summary: "Sugestão determinística preservada separadamente do pacote editorial humano; aplicação requer ação explícita.", status: "PROPOSED", engine_version: this.engineVersion },
    };
  }
}

export function createContentIntelligenceProvider(): ContentIntelligenceProvider { return new DeterministicLocalProvider(); }
export function validateScore(value: number): boolean { return Number.isFinite(value) && value >= 0 && value <= 100; }
export function recommendationDistribution(results: Array<Pick<AiReviewResult, "ai_recommendation">>): Record<AiRecommendation, number> {
  const output: Record<AiRecommendation, number> = { RECOMMEND_APPROVE: 0, RECOMMEND_CHANGES: 0, RECOMMEND_REJECT: 0, HUMAN_REVIEW_REQUIRED: 0 };
  for (const result of results) output[result.ai_recommendation] += 1;
  return output;
}
