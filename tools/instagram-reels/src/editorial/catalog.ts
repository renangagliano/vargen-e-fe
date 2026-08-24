import type { CandidateCategory, EditorialPackage, RightsStatus } from "../shared/types.js";

function pillar(collection: string | null, category: CandidateCategory): { primary: string; secondary: string } {
  if (collection === "12 Meses com Deus") return { primary: "MONTHLY_JOURNEY", secondary: category === "STORY_BUILD" ? "REFLECTION" : "FAITH" };
  if (collection === "7 Dias com Deus  Fé, Força e Superação") return { primary: "WEEKLY_JOURNEY", secondary: "OVERCOMING" };
  if (["Advento", "Anunciação", "Domingo da Páscoa", "Domingo de Ramos e da Paixão", "Quaresma", "Solenidades", "Tempo Comum", "Tempo do Natal"].includes(collection ?? "")) return { primary: "LITURGICAL", secondary: category === "STORY_BUILD" ? "REFLECTION" : "SCRIPTURE" };
  return { primary: category === "STORY_BUILD" ? "REFLECTION" : "FAITH", secondary: "WORSHIP" };
}

function hook(songTitle: string, category: CandidateCategory): string {
  if (category === "LYRICAL_HOOK") return `${songTitle}: uma palavra para continuar.`;
  if (category === "MAIN_CHORUS") return `Quando a fé encontra força em ${songTitle}.`;
  return `Um momento de reflexão com ${songTitle}.`;
}

function cta(category: CandidateCategory): string {
  if (category === "LYRICAL_HOOK") return "Salve para ouvir novamente em outro momento.";
  if (category === "MAIN_CHORUS") return "Compartilhe com alguém que pode acolher esta mensagem.";
  return "Que sentimento este trecho despertou em você?";
}

function hashtags(collection: string | null, category: CandidateCategory): string[] {
  const values = ["#VargenEFé", "#MusicaCrista", "#MusicaCatolica", "#Fe", "#PalavraDeDeus"];
  if (collection === "12 Meses com Deus") values.push("#12MesesComDeus");
  else if (collection === "7 Dias com Deus  Fé, Força e Superação") values.push("#7DiasComDeus", "#Superacao");
  else if (collection) values.push("#Liturgia");
  if (category === "STORY_BUILD") values.push("#Reflexao");
  return values.slice(0, 8);
}

export function generateCatalogEditorialPackage(input: { reelId: string; songTitle: string; collection: string | null; category: CandidateCategory; outputPath: string; rightsStatus: RightsStatus; generatedAt?: string }): EditorialPackage {
  const pillars = pillar(input.collection, input.category);
  const selectedHook = hook(input.songTitle, input.category);
  const referenceNote = "A referência bíblica precisa ser confirmada no contexto editorial da canção antes da publicação.";
  const caption = `${selectedHook}\n\nEste trecho de “${input.songTitle}” transforma a experiência da fé em música e convida a uma pausa no caminho.\n\n${referenceNote}\n\nQual parte desta mensagem encontrou você hoje?\n\nVargen & Fé\nA Bíblia transformada em música.`;
  const coverText = input.category === "MAIN_CHORUS" ? "Fé em movimento" : input.category === "STORY_BUILD" ? "Um momento para refletir" : "Uma palavra para hoje";
  return {
    reel_id: input.reelId,
    editorial_title: `${input.songTitle} — ${input.category === "STORY_BUILD" ? "Momento de reflexão" : input.category === "MAIN_CHORUS" ? "Força para seguir" : "Trecho de fé"}`,
    hook_candidates: [
      { category: "REFLECTION", text: selectedHook },
      { category: "IDENTIFICATION", text: `Talvez este trecho acompanhe o seu momento atual.` },
      { category: "EMOTIONAL", text: `Uma canção também pode ser uma pausa para respirar.` },
    ],
    selected_hook: selectedHook,
    caption,
    bible_reference: "",
    bible_reference_review_required: true,
    cta: cta(input.category),
    hashtags: hashtags(input.collection, input.category),
    content_pillar: pillars.primary,
    secondary_pillar: pillars.secondary,
    editorial_intent: input.category === "STORY_BUILD" ? "Criar uma pausa contemplativa e favorecer retenção reflexiva." : input.category === "MAIN_CHORUS" ? "Apresentar a força musical do trecho com uma mensagem de fé acessível." : "Gerar identificação rápida sem atribuir uma promessa não verificada à canção.",
    cover_filename: input.outputPath.replace(/^.*[\\/]/, "").replace(/\.mp4$/i, ".cover.jpg"),
    cover_path: input.outputPath.replace(/\.mp4$/i, ".cover.jpg"),
    cover_text: coverText,
    editorial_version: 1,
    review_status: "READY_FOR_HUMAN_REVIEW",
    publication_status: "NOT_PUBLISHED",
    publication_priority: input.category === "MAIN_CHORUS" ? "HIGH" : "MEDIUM",
    suggested_context: input.collection ? `Contexto editorial da coleção ${input.collection}; confirmar relevância bíblica antes da aprovação.` : "Contexto editorial requer revisão humana.",
    suggested_spacing: "Manter pelo menos 14 dias antes de outro Reel da mesma música.",
    rights_status: input.rightsStatus,
    generated_at: input.generatedAt ?? new Date().toISOString(),
  };
}

export function validateCatalogEditorialPackage(value: EditorialPackage): string[] {
  const errors: string[] = [];
  if (value.selected_hook.length < 15 || value.selected_hook.length > 140) errors.push("HOOK_LENGTH_INVALID");
  if (!value.caption.startsWith(value.selected_hook)) errors.push("CAPTION_MUST_START_WITH_SELECTED_HOOK");
  if (value.hashtags.length < 5 || value.hashtags.length > 10 || !value.hashtags.includes("#VargenEFé")) errors.push("HASHTAGS_INVALID");
  if (value.review_status !== "READY_FOR_HUMAN_REVIEW") errors.push("REVIEW_STATUS_NOT_PENDING");
  if (value.publication_status !== "NOT_PUBLISHED") errors.push("PUBLICATION_STATUS_NOT_DRY");
  if (!value.bible_reference && !value.bible_reference_review_required) errors.push("BIBLE_REFERENCE_REVIEW_FLAG_MISSING");
  if (value.rights_status !== "RIGHTS_PENDING_CONFIRMATION" && value.rights_status !== "RIGHTS_CONFIRMED") errors.push("RIGHTS_STATUS_INVALID");
  return errors;
}
