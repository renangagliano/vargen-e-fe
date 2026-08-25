import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, type MediaConfig } from "../config/index.js";
import { openDatabase, latestEditorialPackage } from "../database/db.js";
import { editEditorialPackage, type EditorialEdit } from "../publishing/editorial-edit.js";
import { audit } from "../publishing/audit.js";
import { listReviewItems, type ReviewItem } from "../review/service.js";
import type { EditorialPackage, HookCategory, KnowledgeBibleResolution, KnowledgeEditorialSuggestion, Section8EditorialCalibration, Section8GenericLanguage, Section8ReviewQueue, AiDuplicateRisk } from "../shared/types.js";
import { calculateStructuralCompliance } from "./calibration.js";
import { resolveKnowledgeBible, KNOWLEDGE_BIBLE_RESOLVER_VERSION } from "./knowledge-bible.js";
import { loadKnowledgeBase, type KnowledgeBaseEntry } from "./knowledge-base.js";
import { textSimilarity } from "../curation/engine.js";

export const KNOWLEDGE_EDITORIAL_VERSION = "knowledge-aware-editorial-v1";
export const KNOWLEDGE_GENERIC_VERSION = "phase8-generic-language-v1";
export const KNOWLEDGE_CALIBRATION_VERSION = "phase8-knowledge-calibration-v1";
type Mode = "calibration" | "full" | "reel";
type Score = { calibration: Section8EditorialCalibration; suggestion: KnowledgeEditorialSuggestion; bible: KnowledgeBibleResolution };

const GENERIC_PATTERNS = ["uma palavra para continuar", "uma mensagem para hoje", "este trecho nos lembra", "uma canção para", "salve para ouvir novamente", "compartilhe com alguém", "qual trecho falou com você", "quando tudo parece difícil", "não desista", "deus tem algo para você"];
const CTA_OPTIONS = ["Salve para revisitar esta mensagem com calma.", "Compartilhe com alguém que também está vivendo esta travessia.", "Qual imagem ou ideia desta canção mais falou com você?", "Reserve um minuto para refletir e ouvir a música completa.", "Ouça a canção completa e acompanhe a jornada de Vargen & Fé.", "Leve esta reflexão para a sua oração de hoje.", "Siga Vargen & Fé para acompanhar novas canções bíblicas."];
const STOP = new Set("a o os as um uma de do da dos das para por com em no na nos que e é eu você seu sua este esta isso como quando uma alguém trecho música canção Deus fé com".normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/u));

function now(): string { return new Date().toISOString(); }
function hash(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function clamp(value: number): number { return Math.max(0, Math.min(100, Math.round(value * 100) / 100)); }
function normalize(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim(); }
function words(value: string): string[] { return normalize(value).split(" ").filter((word) => word.length > 3 && !STOP.has(word)); }
function unique(value: string[]): string[] { return [...new Set(value.filter(Boolean))]; }
function truncate(value: string, max: number): string { const clean = value.replace(/\s+/g, " ").trim(); return clean.length <= max ? clean : `${clean.slice(0, max - 1).replace(/\s+\S*$/, "")}…`; }
function choose<T>(values: T[], key: string): T { return values[Number.parseInt(hash(key).slice(0, 8), 16) % values.length]; }
function slugTag(value: string): string { return normalize(value).replace(/\s+/g, ""); }
function packageText(pkg: Partial<EditorialPackage> | null): string { return pkg ? `${pkg.editorial_title ?? ""} ${pkg.selected_hook ?? ""} ${pkg.caption ?? ""} ${pkg.cta ?? ""} ${(pkg.hashtags ?? []).join(" ")} ${pkg.cover_text ?? ""}` : ""; }
function packageSimilarity(a: Partial<EditorialPackage>, b: Partial<EditorialPackage>): number {
  const hook = textSimilarity(a.selected_hook ?? "", b.selected_hook ?? "");
  const title = textSimilarity(a.editorial_title ?? "", b.editorial_title ?? "");
  const cover = textSimilarity(a.cover_text ?? "", b.cover_text ?? "");
  const cta = textSimilarity(a.cta ?? "", b.cta ?? "");
  const hashtags = textSimilarity((a.hashtags ?? []).join(" "), (b.hashtags ?? []).join(" "));
  return hook * 0.4 + title * 0.2 + cover * 0.2 + cta * 0.1 + hashtags * 0.1;
}
function contextTokens(entry: KnowledgeBaseEntry): string[] { return unique(words(`${entry.title} ${entry.core_message} ${entry.summary} ${entry.primary_theme} ${entry.secondary_themes.join(" ")} ${entry.biblical_story} ${entry.liturgical_context} ${entry.calendar_context} ${entry.editorial_keywords.join(" ")}`)); }
function overlap(a: string[], b: string[]): number { const set = new Set(b); return a.length ? a.filter((token) => set.has(token)).length / a.length : 0; }

export function selectKnowledgeCalibrationSample(items: ReviewItem[], limit = 10): ReviewItem[] {
  const groups = new Map<string, ReviewItem[]>();
  for (const item of items) { const rows = groups.get(item.collection) ?? []; rows.push(item); groups.set(item.collection, rows); }
  const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
  const selected: ReviewItem[] = [];
  for (const [, rows] of ordered) if (selected.length < limit) selected.push(rows[0]);
  let cursor = 1;
  while (selected.length < Math.min(limit, items.length)) {
    for (const [, rows] of ordered) { if (rows[cursor] && selected.length < Math.min(limit, items.length)) selected.push(rows[cursor]); }
    cursor += 1;
  }
  return selected;
}

function distributionValues(values: string[]): Record<string, number> { return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length])); }

function pillar(entry: KnowledgeBaseEntry): { primary: string; secondary: string | null } {
  const haystack = normalize(`${entry.primary_theme} ${entry.collection} ${entry.liturgical_context}`);
  if (haystack.includes("liturg") || haystack.includes("advento") || haystack.includes("quaresma") || haystack.includes("pascoa") || haystack.includes("natal")) return { primary: "LITURGICAL", secondary: entry.primary_theme || "FAITH" };
  if (haystack.includes("7 dias")) return { primary: "WEEKLY_JOURNEY", secondary: entry.primary_theme || "FAITH" };
  if (haystack.includes("12 meses")) return { primary: "MONTHLY_JOURNEY", secondary: entry.primary_theme || "FAITH" };
  if (haystack.includes("gratida")) return { primary: "GRATITUDE", secondary: entry.primary_theme || "REFLECTION" };
  if (haystack.includes("supera") || haystack.includes("forca") || haystack.includes("coragem")) return { primary: "OVERCOMING", secondary: entry.primary_theme || "FAITH" };
  return { primary: entry.primary_theme ? entry.primary_theme.toUpperCase() : "FAITH", secondary: entry.secondary_themes[0] ? entry.secondary_themes[0].toUpperCase() : "REFLECTION" };
}

function makeSuggestion(item: ReviewItem, entry: KnowledgeBaseEntry, bible: KnowledgeBibleResolution): Partial<EditorialPackage> & { bible_reference_review_required: boolean } {
  const seed = hash(`${item.reel_id}:${KNOWLEDGE_EDITORIAL_VERSION}`);
  const family = Number.parseInt(seed.slice(0, 2), 16) % 3;
  const story = truncate(entry.biblical_story || entry.summary || entry.core_message, 150);
  const message = truncate(entry.core_message || entry.primary_theme || entry.summary, 130);
  const context = entry.calendar_context || entry.liturgical_context || entry.collection;
  const reference = bible.suggested_reference || entry.primary_bible_reference || "";
  const title = truncate(`${entry.title} — ${message}`, 96);
  const hooks = family === 0
    ? [{ category: "QUESTION" as HookCategory, text: truncate(`O que a história de ${story.toLowerCase()} ainda revela sobre ${message.toLowerCase()}?`, 110) }, { category: "SCRIPTURE" as HookCategory, text: truncate(`${reference || "Uma história bíblica"}: ${message}.`, 100) }, { category: "REFLECTION" as HookCategory, text: truncate(`Entre a promessa e o caminho: ${message}.`, 100) }]
    : family === 1
      ? [{ category: "IDENTIFICATION" as HookCategory, text: truncate(`Há momentos em que ${message.toLowerCase()} parece distante.`, 110) }, { category: "SCRIPTURE" as HookCategory, text: truncate(`Uma canção sobre ${story.toLowerCase()}.`, 100) }, { category: "OVERCOMING" as HookCategory, text: truncate(`${message}: uma fé que atravessa o caminho.`, 100) }]
      : [{ category: "EMOTIONAL" as HookCategory, text: truncate(`${message} — cantado a partir de ${story.toLowerCase()}.`, 110) }, { category: "QUESTION" as HookCategory, text: truncate(`Onde esta história encontra a sua própria jornada?`, 100) }, { category: "CURIOSITY" as HookCategory, text: truncate(`O contexto bíblico por trás de ${entry.title}.`, 100) }];
  const selectedHook = hooks[0].text;
  const application = family === 0 ? `A narrativa de ${story.toLowerCase()} não fica distante: ela ilumina decisões, esperas e recomeços concretos.` : family === 1 ? `A canção transforma esse contexto em uma pergunta para a vida: como permanecer fiel ao próximo passo sem perder a esperança?` : `Ao ouvir, deixe que a mensagem encontre o lugar da sua própria caminhada, sem respostas fáceis ou promessas fabricadas.`;
  const refLine = reference ? `Contexto bíblico: ${reference}.` : "Contexto bíblico: referência aguardando verificação humana.";
  const caption = `${selectedHook}\n\n${entry.title} nasce de ${story.toLowerCase()} e se concentra em ${message.toLowerCase()}. ${application}\n\n${refLine} ${context ? `Coleção e contexto: ${context}.` : ""}\n\n${choose(CTA_OPTIONS, `${item.reel_id}:${family}`)}\n\nVargen & Fé\nA Bíblia transformada em música.`;
  const p = pillar(entry);
  const contextual = ["#VargenEFé", "#MusicaCatolica", "#MusicaCrista", entry.primary_theme && `#${slugTag(entry.primary_theme)}`, entry.biblical_story && `#${slugTag(entry.biblical_story.split(" ").slice(0, 2).join(""))}`, context && `#${slugTag(context.split(" ").slice(0, 2).join(""))}`, reference && `#${slugTag(reference.split(" ")[0])}`];
  const hashtags = unique(contextual.filter((tag): tag is string => Boolean(tag))).slice(0, 8);
  const cover = truncate(message.split(/[:.;]/u)[0], 42);
  return { reel_id: item.reel_id, editorial_title: title, hook_candidates: hooks, selected_hook: selectedHook, caption, bible_reference: reference, bible_reference_review_required: bible.classification !== "HUMAN_VERIFIED", cta: choose(CTA_OPTIONS, `${item.reel_id}:${family}`), hashtags, content_pillar: p.primary, secondary_pillar: p.secondary, editorial_intent: family === 0 ? `Conectar a narrativa bíblica de ${story.toLowerCase()} com uma decisão humana concreta.` : family === 1 ? `Apresentar o contexto de ${entry.title} como uma mensagem musical específica e compartilhável.` : `Criar uma pausa reflexiva ancorada em ${message.toLowerCase()} e no contexto ${context}.`, cover_text: cover };
}

export function classifyKnowledgeGeneric(pkg: Partial<EditorialPackage>, entry: KnowledgeBaseEntry): { level: Section8GenericLanguage; phrases: string[] } {
  const haystack = normalize(packageText(pkg));
  const hits = GENERIC_PATTERNS.filter((pattern) => haystack.includes(normalize(pattern)));
  const context = contextTokens(entry);
  const used = context.filter((token) => haystack.includes(token)).length;
  if (hits.length >= 2 || (hits.length === 1 && used < 3)) return { level: "GENERIC_HIGH", phrases: hits };
  if (hits.length === 1 || used < 3) return { level: "GENERIC_MEDIUM", phrases: hits };
  return { level: "GENERIC_LOW", phrases: hits };
}

export function scoreKnowledgeEditorial(item: ReviewItem, entry: KnowledgeBaseEntry, pkg: Partial<EditorialPackage>, bible: KnowledgeBibleResolution, corpus: Array<{ item: ReviewItem; entry: KnowledgeBaseEntry; pkg: Partial<EditorialPackage> }>): Omit<Section8EditorialCalibration, "reel_id" | "song_slug" | "calibration_version" | "old_overall_score" | "old_editorial_quality_score" | "review_priority_rank" | "knowledge_context_hash"> {
  const structure = calculateStructuralCompliance(pkg as EditorialPackage);
  const structural = Object.values(structure).reduce((sum, value) => sum + value, 0) / 4;
  const context = contextTokens(entry);
  const allText = normalize(packageText(pkg));
  const specificity = clamp(25 + overlap(context, words(allText)) * 60);
  const bibleTerms = words(`${entry.biblical_story} ${entry.core_message} ${entry.primary_bible_reference}`);
  const biblicalAlignment = clamp((bible.suggested_reference ? 35 : 0) + overlap(bibleTerms, words(allText)) * 35 + (bible.classification === "HUMAN_VERIFIED" ? 30 : bible.classification === "KNOWLEDGE_CORROBORATED_HIGH" ? 15 : 5));
  const songAlignment = clamp(40 + overlap(context, words(allText)) * 60);
  const similarities = corpus.filter((row) => row.item.reel_id !== item.reel_id).map((row) => ({ id: row.item.reel_id, value: packageSimilarity(pkg, row.pkg) * 100 })).sort((a, b) => b.value - a.value);
  const duplicatePenalty = clamp(similarities[0]?.value ?? 0);
  const distinctiveness = clamp(100 - duplicatePenalty);
  const brandVoice = clamp((/vargen/i.test(packageText(pkg)) ? 35 : 0) + (!/garant|dinheiro|comente.{0,20}amen|milagre certo/iu.test(packageText(pkg)) ? 45 : 0) + (String(pkg.caption ?? "").includes("A Bíblia transformada em música") ? 20 : 0));
  const narrativeValue = clamp((entry.biblical_story ? 30 : 0) + (entry.core_message ? 25 : 0) + (entry.primary_theme ? 15 : 0) + (String(pkg.caption ?? "").split(/\n\s*\n/).filter(Boolean).length >= 3 ? 20 : 0) + (specificity >= 70 ? 10 : 0));
  const ctaQuality = clamp((pkg.cta && !GENERIC_PATTERNS.some((pattern) => normalize(pkg.cta ?? "").includes(normalize(pattern))) ? 70 : 35) + (String(pkg.cta ?? "").includes("?") ? 15 : 0) + (pkg.cta ? 15 : 0));
  const retention = clamp((item.duration_ms >= 15000 && item.duration_ms <= 60000 ? 35 : 20) + (specificity * 0.3) + (item.curation.distinctiveness * 0.2));
  const generic = classifyKnowledgeGeneric(pkg, entry);
  const quality = clamp(structural * 0.08 + specificity * 0.18 + biblicalAlignment * 0.16 + songAlignment * 0.14 + distinctiveness * 0.14 + brandVoice * 0.1 + narrativeValue * 0.1 + ctaQuality * 0.05 + retention * 0.05 - duplicatePenalty * 0.08);
  const duplicateRisk: AiDuplicateRisk = duplicatePenalty >= 65 ? "HIGH" : duplicatePenalty >= 35 ? "MEDIUM" : "LOW";
  const related = similarities.filter((row) => row.value >= 35).slice(0, 5).map((row) => row.id);
  const classification = bible.classification;
  const queue: Section8ReviewQueue = classification === "CONFLICT" ? "CONFLICT_REVIEW" : generic.level === "GENERIC_HIGH" || duplicateRisk === "HIGH" || quality < 62 ? "EDITORIAL_CHANGES_REQUIRED" : (classification !== "HUMAN_VERIFIED" && classification !== "KNOWLEDGE_CORROBORATED_HIGH") ? "BIBLE_VERIFICATION_REQUIRED" : quality >= 78 && generic.level === "GENERIC_LOW" && duplicateRisk === "LOW" ? "FAST_PATH" : "STANDARD_REVIEW";
  const priority = clamp(quality * 0.55 + specificity * 0.15 + (classification === "KNOWLEDGE_CORROBORATED_HIGH" || classification === "HUMAN_VERIFIED" ? 20 : 8) + (duplicateRisk === "LOW" ? 10 : duplicateRisk === "MEDIUM" ? 4 : 0));
  return { structural_compliance: clamp(structural), specificity_score: specificity, biblical_alignment_score: biblicalAlignment, song_context_alignment_score: songAlignment, distinctiveness_score: distinctiveness, brand_voice_score: brandVoice, narrative_value_score: narrativeValue, cta_quality_score: ctaQuality, retention_potential_score: retention, duplication_penalty: duplicatePenalty, editorial_quality_score: quality, generic_language_level: generic.level, generic_phrases: generic.phrases, duplicate_risk: duplicateRisk, related_reel_ids: related, bible_classification: classification, review_queue: queue, review_priority_score: priority, reasoning_summary: `Qualidade separa conformidade estrutural de especificidade, alinhamento bíblico, contexto do song e distintividade. A sugestão usa ${entry.primary_bible_reference || "contexto bíblico sem referência"}; verificação e aprovação continuam humanas.` };
}

function persistSuggestion(db: ReturnType<typeof openDatabase>, item: ReviewItem, entry: KnowledgeBaseEntry, pkg: Partial<EditorialPackage>, contextHash: string): KnowledgeEditorialSuggestion {
  const changed = ["editorial_title", "selected_hook", "caption", "bible_reference", "cta", "hashtags", "content_pillar", "secondary_pillar", "cover_text"];
  const suggestion: KnowledgeEditorialSuggestion = { suggestion_id: `section8-editorial-${hash(`${item.reel_id}:${KNOWLEDGE_EDITORIAL_VERSION}`).slice(0, 32)}`, reel_id: item.reel_id, song_slug: item.song_slug, suggestion_version: KNOWLEDGE_EDITORIAL_VERSION, base_editorial_version: item.editorial?.editorial_version ?? 0, suggested_package: pkg, changed_fields: changed, source_context: { knowledge_context_hash: contextHash, entry }, reasoning_summary: `Sugestão determinística local baseada no contexto específico de ${entry.title}. Não é uma aprovação nem uma verificação bíblica.`, status: "PROPOSED" };
  const timestamp = now();
  db.prepare(`INSERT INTO knowledge_editorial_suggestions (suggestion_id, reel_id, song_slug, suggestion_version, base_editorial_version, package_json, changed_fields_json, source_context_json, reasoning_summary, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(reel_id, suggestion_version) DO UPDATE SET base_editorial_version=excluded.base_editorial_version, package_json=excluded.package_json, changed_fields_json=excluded.changed_fields_json, source_context_json=excluded.source_context_json, reasoning_summary=excluded.reasoning_summary, status=CASE WHEN knowledge_editorial_suggestions.status='APPLIED' THEN 'APPLIED' ELSE excluded.status END, updated_at=excluded.updated_at`).run(suggestion.suggestion_id, suggestion.reel_id, suggestion.song_slug, suggestion.suggestion_version, suggestion.base_editorial_version, JSON.stringify(suggestion.suggested_package), JSON.stringify(suggestion.changed_fields), JSON.stringify(suggestion.source_context), suggestion.reasoning_summary, suggestion.status, timestamp, timestamp);
  audit(db, { eventId: `section8-editorial-generated:${item.reel_id}:${KNOWLEDGE_EDITORIAL_VERSION}`, entityType: "REEL", entityId: item.reel_id, eventType: "KNOWLEDGE_EDITORIAL_GENERATED", actor: "phase8-knowledge-engine", metadata: { suggestion_version: KNOWLEDGE_EDITORIAL_VERSION, base_editorial_version: suggestion.base_editorial_version, knowledge_context_hash: contextHash } });
  return suggestion;
}

async function processItems(items: ReviewItem[], config: MediaConfig): Promise<{ scores: Score[]; kbHash: string }> {
  const { bySlug, contentHash } = await loadKnowledgeBase(config);
  const db = openDatabase(config);
  try {
    const drafts: Array<{ item: ReviewItem; entry: KnowledgeBaseEntry; bible: KnowledgeBibleResolution; pkg: Partial<EditorialPackage> }> = [];
    for (const item of items) {
      const entry = bySlug.get(item.song_slug);
      if (!entry) continue;
      const bible = await resolveKnowledgeBible(item, config);
      const pkg = makeSuggestion(item, entry, bible);
      drafts.push({ item, entry, bible, pkg });
    }
    const scores: Score[] = [];
    for (const draft of drafts) {
      const metrics = scoreKnowledgeEditorial(draft.item, draft.entry, draft.pkg, draft.bible, drafts);
      const suggestion = persistSuggestion(db, draft.item, draft.entry, draft.pkg, contentHash);
      const old = draft.item.editorial_calibration;
      const calibration: Section8EditorialCalibration = { reel_id: draft.item.reel_id, song_slug: draft.item.song_slug, calibration_version: KNOWLEDGE_CALIBRATION_VERSION, old_overall_score: old?.overall_score ?? null, old_editorial_quality_score: old?.editorial_quality_score ?? null, ...metrics, review_priority_rank: null, knowledge_context_hash: contentHash };
      const timestamp = now();
      db.prepare(`INSERT INTO section8_editorial_calibrations (calibration_id, reel_id, song_slug, calibration_version, old_overall_score, old_editorial_quality_score, structural_compliance, specificity_score, biblical_alignment_score, song_context_alignment_score, distinctiveness_score, brand_voice_score, narrative_value_score, cta_quality_score, retention_potential_score, duplication_penalty, editorial_quality_score, generic_language_level, generic_phrases_json, duplicate_risk, related_reel_ids_json, bible_classification, review_queue, review_priority_score, review_priority_rank, reasoning_summary, knowledge_context_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(reel_id, calibration_version) DO UPDATE SET old_overall_score=excluded.old_overall_score, old_editorial_quality_score=excluded.old_editorial_quality_score, structural_compliance=excluded.structural_compliance, specificity_score=excluded.specificity_score, biblical_alignment_score=excluded.biblical_alignment_score, song_context_alignment_score=excluded.song_context_alignment_score, distinctiveness_score=excluded.distinctiveness_score, brand_voice_score=excluded.brand_voice_score, narrative_value_score=excluded.narrative_value_score, cta_quality_score=excluded.cta_quality_score, retention_potential_score=excluded.retention_potential_score, duplication_penalty=excluded.duplication_penalty, editorial_quality_score=excluded.editorial_quality_score, generic_language_level=excluded.generic_language_level, generic_phrases_json=excluded.generic_phrases_json, duplicate_risk=excluded.duplicate_risk, related_reel_ids_json=excluded.related_reel_ids_json, bible_classification=excluded.bible_classification, review_queue=excluded.review_queue, review_priority_score=excluded.review_priority_score, reasoning_summary=excluded.reasoning_summary, knowledge_context_hash=excluded.knowledge_context_hash, updated_at=excluded.updated_at`).run(`section8-calibration-${hash(`${draft.item.reel_id}:${KNOWLEDGE_CALIBRATION_VERSION}`).slice(0, 32)}`, calibration.reel_id, calibration.song_slug, calibration.calibration_version, calibration.old_overall_score, calibration.old_editorial_quality_score, calibration.structural_compliance, calibration.specificity_score, calibration.biblical_alignment_score, calibration.song_context_alignment_score, calibration.distinctiveness_score, calibration.brand_voice_score, calibration.narrative_value_score, calibration.cta_quality_score, calibration.retention_potential_score, calibration.duplication_penalty, calibration.editorial_quality_score, calibration.generic_language_level, JSON.stringify(calibration.generic_phrases), calibration.duplicate_risk, JSON.stringify(calibration.related_reel_ids), calibration.bible_classification, calibration.review_queue, calibration.review_priority_score, null, calibration.reasoning_summary, calibration.knowledge_context_hash, timestamp, timestamp);
      scores.push({ bible: draft.bible, suggestion, calibration });
    }
    const ranked = [...scores].sort((a, b) => b.calibration.review_priority_score - a.calibration.review_priority_score);
    for (let index = 0; index < ranked.length; index += 1) { ranked[index].calibration.review_priority_rank = index + 1; db.prepare("UPDATE section8_editorial_calibrations SET review_priority_rank = ? WHERE reel_id = ? AND calibration_version = ?").run(index + 1, ranked[index].calibration.reel_id, KNOWLEDGE_CALIBRATION_VERSION); }
    return { scores, kbHash: contentHash };
  } finally { db.close(); }
}

function reportFor(mode: Mode, scores: Score[], kbHash: string, sample: ReviewItem[]): Record<string, unknown> {
  const count = (selector: (score: Score) => boolean) => scores.filter(selector).length;
  const distribution = (selector: (score: Score) => string) => Object.fromEntries([...new Set(scores.map(selector))].sort().map((value) => [value, scores.filter((score) => selector(score) === value).length]));
  const average = (selector: (score: Score) => number) => scores.length ? Math.round(scores.reduce((sum, score) => sum + selector(score), 0) / scores.length * 100) / 100 : null;
  const oldCalibrations = sample.map((item) => item.editorial_calibration).filter((value): value is NonNullable<ReviewItem["editorial_calibration"]> => Boolean(value));
  return { generated_at: now(), mode, scope: mode === "full" ? "PRIMARY" : "PRIMARY_CALIBRATION_SAMPLE", resolver_version: KNOWLEDGE_BIBLE_RESOLVER_VERSION, editorial_version: KNOWLEDGE_EDITORIAL_VERSION, generic_version: KNOWLEDGE_GENERIC_VERSION, knowledge_context_hash: kbHash, processed: scores.length, sample_songs: sample.map((item) => ({ reel_id: item.reel_id, song: item.song_title, collection: item.collection })), bible_classification: distribution((score) => score.bible.classification), generic_language_distribution: distribution((score) => score.calibration.generic_language_level), generic_language_before_distribution: distributionValues(oldCalibrations.map((value) => value.generic_language_level)), duplicate_risk_distribution: distribution((score) => score.calibration.duplicate_risk), duplicate_risk_before_distribution: distributionValues(oldCalibrations.map((value) => value.duplicate_risk)), queue_distribution: distribution((score) => score.calibration.review_queue), queue_counts: { FAST_PATH: count((score) => score.calibration.review_queue === "FAST_PATH"), STANDARD_REVIEW: count((score) => score.calibration.review_queue === "STANDARD_REVIEW"), EDITORIAL_CHANGES_REQUIRED: count((score) => score.calibration.review_queue === "EDITORIAL_CHANGES_REQUIRED"), BIBLE_VERIFICATION_REQUIRED: count((score) => score.calibration.review_queue === "BIBLE_VERIFICATION_REQUIRED"), CONFLICT_REVIEW: count((score) => score.calibration.review_queue === "CONFLICT_REVIEW") }, averages: { editorial_quality: average((score) => score.calibration.editorial_quality_score), specificity: average((score) => score.calibration.specificity_score), biblical_alignment: average((score) => score.calibration.biblical_alignment_score), duplication_penalty: average((score) => score.calibration.duplication_penalty), old_editorial_quality: average((score) => score.calibration.old_editorial_quality_score ?? 0) }, fast_path: count((score) => score.calibration.review_queue === "FAST_PATH"), results: scores.map((score) => ({ reel_id: score.calibration.reel_id, song_slug: score.calibration.song_slug, bible: { classification: score.bible.classification, reference: score.bible.suggested_reference, confidence: score.bible.confidence_level, confidence_score: score.bible.confidence_score, evidence_sources: score.bible.evidence_sources, reasoning: score.bible.reasoning_summary }, suggestion: score.suggestion, calibration: score.calibration })) };
}

export async function runKnowledgeAwareEditorial(input: { mode: Mode; limit?: number; reelId?: string }, config: MediaConfig = loadConfig()): Promise<{ mode: Mode; candidates: number; discriminative: boolean; report: Record<string, unknown>; reportPaths: { jsonPath: string; htmlPath: string } }> {
  const all = await listReviewItems("primary", {}, config);
  const sample = input.mode === "full" ? all : input.reelId ? all.filter((item) => item.reel_id === input.reelId) : selectKnowledgeCalibrationSample(all, input.limit ?? 10);
  const result = await processItems(sample, config);
  const report = reportFor(input.mode, result.scores, result.kbHash, sample);
  const qualityValues = result.scores.map((score) => score.calibration.editorial_quality_score);
  const qualityRange = qualityValues.length ? Math.max(...qualityValues) - Math.min(...qualityValues) : 0;
  const discriminative = result.scores.length > 0 && (new Set(result.scores.map((score) => score.calibration.review_queue)).size > 1 || new Set(result.scores.map((score) => score.calibration.duplicate_risk)).size > 1 || qualityRange >= 5);
  const reportName = input.mode === "full" ? "section8-primary" : "section8-calibration";
  const reportPaths = await writeReport(config, reportName, report);
  return { mode: input.mode, candidates: result.scores.length, discriminative, report, reportPaths };
}

async function writeReport(config: MediaConfig, name: string, report: Record<string, unknown>): Promise<{ jsonPath: string; htmlPath: string }> {
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  const jsonPath = path.join(config.reelsOutputRoot, `${name}.json`);
  const htmlPath = path.join(config.reelsOutputRoot, `${name}.html`);
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const escape = (value: unknown) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char));
  const rows = (Array.isArray(report.results) ? report.results as Array<Record<string, unknown>> : []).map((row) => { const calibration = row.calibration as Record<string, unknown>; const bible = row.bible as Record<string, unknown>; const suggestion = row.suggestion as Record<string, unknown>; const pkg = suggestion.suggested_package as Record<string, unknown>; return `<article><h2>${escape(row.song_slug)}</h2><p>${escape(calibration.review_queue)} · ${escape(calibration.generic_language_level)} · ${escape(calibration.duplicate_risk)} · score ${escape(calibration.editorial_quality_score)}</p><p>Bíblia: ${escape(bible.classification)} · ${escape(bible.reference || "sem sugestão")} · ${escape(bible.confidence)}</p><h3>${escape(pkg.editorial_title)}</h3><p>${escape(pkg.selected_hook)}</p><p>${escape(calibration.reasoning_summary)}</p></article>`; }).join("\n");
  await fs.writeFile(htmlPath, `<!doctype html><meta charset="utf-8"><title>Vargen & Fé — Section 8</title><style>body{font:16px system-ui;background:#111;color:#eee;max-width:1100px;margin:24px auto;padding:0 16px}article{border:1px solid #444;border-radius:8px;padding:14px;margin:12px 0}h1{color:#e5c07b}small{color:#bbb}</style><h1>Section 8 — ${escape(report.mode)}</h1><p>Relatório local determinístico. Sugestões requerem revisão humana.</p>${rows}`, "utf8");
  return { jsonPath, htmlPath };
}

export async function writeKnowledgeEditorialReport(config: MediaConfig = loadConfig(), full = true): Promise<{ jsonPath: string; htmlPath: string }> { const result = await runKnowledgeAwareEditorial({ mode: full ? "full" : "calibration" }, config); return result.reportPaths; }

export async function applyKnowledgeSuggestion(reelId: string, fields: string[] | undefined, actor: string, config: MediaConfig = loadConfig()): Promise<EditorialPackage> {
  if (!actor.trim()) throw new Error("ACTOR_REQUIRED");
  const db = openDatabase(config);
  let packageValue: Record<string, unknown>;
  try { const row = db.prepare("SELECT package_json FROM knowledge_editorial_suggestions WHERE reel_id = ? AND suggestion_version = ?").get(reelId, KNOWLEDGE_EDITORIAL_VERSION) as { package_json?: string } | undefined; if (!row?.package_json) throw new Error("KNOWLEDGE_EDITORIAL_SUGGESTION_NOT_FOUND"); packageValue = JSON.parse(row.package_json) as Record<string, unknown>; } finally { db.close(); }
  const allowed = new Set(["editorial_title", "selected_hook", "caption", "cta", "hashtags", "content_pillar", "secondary_pillar", "bible_reference", "bible_reference_review_required", "cover_text"]);
  const chosen = (fields?.length ? fields : [...allowed]).filter((field) => allowed.has(field));
  const changes: EditorialEdit = {};
  for (const field of chosen) if (field in packageValue) (changes as Record<string, unknown>)[field] = packageValue[field];
  // The editorial validator requires the caption to begin with the selected
  // hook. Keep selective application safe by carrying this dependent field
  // when the operator selects only the hook.
  if (changes.selected_hook !== undefined && changes.caption === undefined && typeof packageValue.caption === "string") changes.caption = packageValue.caption;
  if (!Object.keys(changes).length) throw new Error("NO_KNOWLEDGE_EDITORIAL_FIELDS");
  const updated = await editEditorialPackage(reelId, actor, changes, config);
  const after = openDatabase(config);
  try { after.prepare("UPDATE knowledge_editorial_suggestions SET status = 'APPLIED', updated_at = ? WHERE reel_id = ? AND suggestion_version = ?").run(now(), reelId, KNOWLEDGE_EDITORIAL_VERSION); audit(after, { eventId: `section8-editorial-applied:${reelId}:${KNOWLEDGE_EDITORIAL_VERSION}:${updated.editorial_version}`, entityType: "REEL", entityId: reelId, eventType: "KNOWLEDGE_EDITORIAL_APPLIED", actor, metadata: { suggestion_version: KNOWLEDGE_EDITORIAL_VERSION, editorial_version: updated.editorial_version, fields: Object.keys(changes) } }); } finally { after.close(); }
  return updated;
}

export type { Mode as KnowledgeEditorialMode, Score as KnowledgeEditorialScore };
