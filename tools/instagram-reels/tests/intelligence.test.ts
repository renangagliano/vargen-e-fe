import assert from "node:assert/strict";
import test from "node:test";
import { extractExplicitReferences } from "../src/intelligence/registry.js";
import { calculateStructuralCompliance, classifyGenericLanguage, selectPhase72CalibrationSample } from "../src/intelligence/calibration.js";
import { normalizeCatholicReference, parseCanonicalReference } from "../src/intelligence/biblical.js";
import type { EditorialPackage } from "../src/shared/types.js";

function editorial(overrides: Partial<EditorialPackage> = {}): EditorialPackage {
  return { reel_id: "reel-test", editorial_title: "Título específico", hook_candidates: [], selected_hook: "Quando a fé precisa avançar?", caption: "Quando a fé precisa avançar?\n\nUma reflexão concreta para a caminhada.\n\nVargen & Fé\nA Bíblia transformada em música.", bible_reference: "", cta: "Qual palavra falou com você?", hashtags: ["#VargenEFé", "#Fe", "#MusicaCrista", "#Biblia", "#Superacao"], content_pillar: "FAITH", secondary_pillar: null, editorial_intent: "reflexão", cover_filename: "cover.jpg", cover_path: "cover.jpg", cover_text: "Fé para avançar", editorial_version: 1, review_status: "READY_FOR_HUMAN_REVIEW", publication_status: "NOT_PUBLISHED", publication_priority: "MEDIUM", suggested_context: "evergreen", suggested_spacing: "7 dias", rights_status: "RIGHTS_PENDING_CONFIRMATION", generated_at: new Date().toISOString(), ...overrides };
}

test("normaliza referência católica sem inventar versículos", () => {
  assert.equal(normalizeCatholicReference("  salmos  23 "), "Salmo 23");
  assert.equal(normalizeCatholicReference("Lucas 3, 15-16.21-22"), "Lucas 3,15-16.21-22");
  assert.deepEqual(parseCanonicalReference("Êxodo 14"), { book: "Êxodo", chapter: 14, verseStart: null, verseEnd: null, displayReference: "Êxodo 14" });
});

test("extrai somente citações explícitas", () => {
  assert.deepEqual(extractExplicitReferences("Tema: Êxodo 14 e João 14,27."), ["Êxodo 14", "João 14,27"]);
  assert.deepEqual(extractExplicitReferences("Quando as águas se abriram"), []);
});

test("separa conformidade estrutural de qualidade genérica", () => {
  const value = editorial();
  const structure = calculateStructuralCompliance(value);
  assert.equal(structure.hook_structure_score, 100);
  assert.equal(structure.caption_structure_score, 100);
  const generic = classifyGenericLanguage(editorial({ selected_hook: "Uma mensagem para hoje", caption: "Este trecho nos lembra uma palavra para continuar." }), [
    { editorial: editorial({ selected_hook: "Uma mensagem para hoje", caption: "Este trecho nos lembra uma palavra para continuar." }) } as never,
  ]);
  assert.equal(generic, "GENERIC_HIGH");
});

test("seleciona amostra Phase 7.2 com diversidade de coleções", () => {
  const items = [
    { song_title: "Quando as Águas se Abriram — Março", collection: "12 Meses com Deus" },
    { song_title: "Quarta-feira", collection: "7 Dias com Deus  Fé, Força e Superação" },
    { song_title: "Hoje a Salvação", collection: "Tempo Comum" },
    { song_title: "Eu Também", collection: "Quaresma" },
    { song_title: "Como Eu Vos Amei", collection: "Domingo da Páscoa" },
    { song_title: "A Estrela", collection: "Tempo do Natal" },
    { song_title: "Deus Conosco", collection: "Anunciação" },
    { song_title: "Sereis", collection: "Solenidades" },
    { song_title: "Outro", collection: "Advento" },
    { song_title: "Outro 2", collection: "Tempo Comum" },
  ].map((value, index) => ({ ...value, reel_id: `reel-${index}`, curation: { rank: 1 } })) as never[];
  const sample = selectPhase72CalibrationSample(items as never, 10);
  assert.equal(sample.length, 10);
  assert.ok(sample.some((item) => item.collection === "Tempo Comum"));
  assert.ok(sample.some((item) => item.collection === "7 Dias com Deus  Fé, Força e Superação"));
});
