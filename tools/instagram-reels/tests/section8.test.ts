import assert from "node:assert/strict";
import test from "node:test";
import { loadKnowledgeBase } from "../src/intelligence/knowledge-base.js";
import { classifyKnowledgeBible } from "../src/intelligence/knowledge-bible.js";
import { classifyKnowledgeGeneric, selectKnowledgeCalibrationSample } from "../src/intelligence/knowledge-editorial.js";
import { applyKnowledgeSuggestion, runKnowledgeAwareEditorial } from "../src/intelligence/knowledge-editorial.js";
import { openDatabase } from "../src/database/db.js";
import { fixture } from "./review.test.js";
import type { ReviewItem } from "../src/review/service.js";

const item = (overrides: Partial<ReviewItem> = {}): ReviewItem => ({ reel_id: "reel-section8", candidate_id: "candidate", source_asset_id: "asset", song_title: "Quando as Águas se Abriram", song_slug: "12-meses-com-deus-quando-as-aguas-se-abriram-marco", collection: "12 Meses com Deus", source_filename: "source.mp4", source_relative_path: "source.mp4", output_relative_path: "reel.mp4", cover_relative_path: "reel.jpg", thumbnail_relative_path: null, duration_ms: 30000, start_time_ms: 0, end_time_ms: 30000, technical: { validation_status: "PASS", width: 1080, height: 1920, fps: 30, video_codec: "h264", audio_codec: "aac", file_size: 1 }, curation: { score: 80, old_score: 80, tier: "TIER_A", rank: 1, portfolio_status: "ACTIVE", decision: "KEEP_PRIMARY", reason: "test", distinctiveness: 80, incremental_value: 80, seasonality: "MONTH_SPECIFIC", calendar_context: "Março" }, editorial: null, bible: { status: "MISSING", reference: null, source: null, evidence: "" }, rights_status: "RIGHTS_PENDING_CONFIRMATION", publication_status: "NOT_PUBLISHED", ...overrides });

test("carrega o Knowledge Base canônico e preserva integridade", async () => {
  const loaded = await loadKnowledgeBase(process.cwd());
  assert.equal(loaded.catalog.record_count, 79);
  assert.equal(loaded.bySlug.size, 79);
  assert.equal(loaded.bySlug.get("12-meses-com-deus-quando-as-aguas-se-abriram-marco")?.primary_bible_reference, "Êxodo 14");
});

test("classifica referência do Knowledge Base como sugestão, não verificação humana", async () => {
  const loaded = await loadKnowledgeBase(process.cwd());
  const entry = loaded.bySlug.get("12-meses-com-deus-quando-as-aguas-se-abriram-marco");
  assert.ok(entry);
  const result = classifyKnowledgeBible(entry, item());
  assert.equal(result.classification, "KNOWLEDGE_CORROBORATED_HIGH");
  assert.equal(result.suggestedReference, "Êxodo 14");
});

test("preserva precedência de HUMAN_VERIFIED e detecta conflito", async () => {
  const loaded = await loadKnowledgeBase(process.cwd());
  const entry = loaded.bySlug.get("12-meses-com-deus-quando-as-aguas-se-abriram-marco");
  assert.ok(entry);
  const verified = classifyKnowledgeBible(entry, item({ bible: { status: "VERIFIED", reference: "Êxodo 14", source: null, evidence: "human" } }));
  assert.equal(verified.classification, "HUMAN_VERIFIED");
  const conflict = classifyKnowledgeBible(entry, item({ bible: { status: "VERIFIED", reference: "João 14,27", source: null, evidence: "human" } }));
  assert.equal(conflict.classification, "CONFLICT");
});

test("classificador Section 8 separa linguagem genérica de contexto", async () => {
  const loaded = await loadKnowledgeBase(process.cwd());
  const entry = loaded.bySlug.get("12-meses-com-deus-quando-as-aguas-se-abriram-marco");
  assert.ok(entry);
  const contextual = { editorial_title: "Quando as Águas se Abriram — Travessia e coragem", selected_hook: "O que a travessia do Mar Vermelho revela sobre coragem?", caption: "Êxodo 14 encontra a decisão de seguir em frente.", cta: "Leve esta reflexão para a sua oração.", cover_text: "Fé para atravessar" };
  const generic = { editorial_title: "Uma mensagem para hoje", selected_hook: "Uma palavra para continuar", caption: "Este trecho nos lembra que Deus tem algo para você.", cta: "Salve para ouvir novamente", cover_text: "Não desista" };
  assert.equal(classifyKnowledgeGeneric(contextual, entry).level, "GENERIC_LOW");
  assert.equal(classifyKnowledgeGeneric(generic, entry).level, "GENERIC_HIGH");
});

test("seleciona amostra Section 8 com diversidade de coleções", () => {
  const rows = ["12 Meses com Deus", "7 Dias com Deus", "Advento", "Quaresma", "Tempo Comum", "Tempo do Natal", "Domingo da Páscoa", "Solenidades", "Outros", "Liturgia"].map((collection, index) => item({ reel_id: `reel-${index}`, collection, song_slug: `song-${index}` }));
  const sample = selectKnowledgeCalibrationSample(rows, 10);
  assert.equal(sample.length, 10);
  assert.equal(new Set(sample.map((row) => row.collection)).size, 10);
});

test("sugestão Section 8 é idempotente, aplicada apenas explicitamente e preserva governança", async () => {
  const itemFixture = await fixture();
  const first = await runKnowledgeAwareEditorial({ mode: "reel", reelId: itemFixture.reelId }, itemFixture.config);
  const second = await runKnowledgeAwareEditorial({ mode: "reel", reelId: itemFixture.reelId }, itemFixture.config);
  assert.equal(first.candidates, 1);
  assert.equal(second.candidates, 1);
  const before = openDatabase(itemFixture.config);
  try {
    assert.equal((before.prepare("SELECT count(*) AS count FROM knowledge_editorial_suggestions WHERE reel_id = ?").get(itemFixture.reelId) as { count: number }).count, 1);
    assert.equal((before.prepare("SELECT count(*) AS count FROM reel_editorial_packages WHERE reel_id = ?").get(itemFixture.reelId) as { count: number }).count, 1);
  } finally { before.close(); }
  const applied = await applyKnowledgeSuggestion(itemFixture.reelId, ["selected_hook"], "qa-section8", itemFixture.config);
  assert.equal(applied.editorial_version, 2);
  assert.equal(applied.review_status, "READY_FOR_HUMAN_REVIEW");
  const after = openDatabase(itemFixture.config);
  try {
    assert.equal((after.prepare("SELECT rights_status FROM derived_reels WHERE reel_id = ?").get(itemFixture.reelId) as { rights_status: string }).rights_status, "RIGHTS_PENDING_CONFIRMATION");
    assert.equal((after.prepare("SELECT count(*) AS count FROM publication_jobs").get() as { count: number }).count, 0);
    assert.equal((after.prepare("SELECT count(*) AS count FROM publication_audit_events WHERE event_type = 'KNOWLEDGE_EDITORIAL_APPLIED'").get() as { count: number }).count, 1);
  } finally { after.close(); }
});
