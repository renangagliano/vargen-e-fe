import type { CandidateCategory, EditorialPackage, HookCandidate, PublicationPriority, RightsStatus } from "../shared/types.js";

export const EDITORIAL_VERSION = 1;
export const PILOT_SONG_TITLE = "Quando as Águas se Abriram — Março";
export const PILOT_COLLECTION = "12 Meses com Deus";
export const PILOT_BIBLE_REFERENCE = "Êxodo 14";

type EditorialPreset = Omit<EditorialPackage, "reel_id" | "cover_filename" | "cover_path" | "editorial_version" | "rights_status" | "generated_at">;

const presets: Record<Extract<CandidateCategory, "LYRICAL_HOOK" | "MAIN_CHORUS" | "STORY_BUILD">, EditorialPreset> = {
  LYRICAL_HOOK: {
    editorial_title: "Quando as Águas se Abriram — Fé para Avançar",
    hook_candidates: [
      { category: "QUESTION", text: "O que você faz quando o caminho parece impossível?" },
      { category: "SCRIPTURE", text: "Quando Deus abre um caminho, a fé aprende a avançar." },
      { category: "IDENTIFICATION", text: "Talvez você esteja exatamente diante do seu mar." },
    ],
    selected_hook: "O que você faz quando o caminho parece impossível?",
    caption: "O que você faz quando o caminho parece impossível?\n\nHá momentos em que a fé não elimina o mar — ela nos dá coragem para dar o próximo passo. Esta canção nasceu para lembrar que permanecer em movimento também pode ser uma forma de confiança.\n\nEm Êxodo 14, o povo de Deus atravessa uma fronteira que parecia não ter passagem.\n\nQual passo de fé você precisa dar hoje?\n\nVargen & Fé\nA Bíblia transformada em música.",
    bible_reference: PILOT_BIBLE_REFERENCE,
    cta: "Salve para ouvir novamente quando precisar lembrar de continuar.",
    hashtags: ["#VargenEFé", "#MusicaCatolica", "#MusicaCrista", "#Fe", "#Superacao", "#Exodo", "#PalavraDeDeus"],
    content_pillar: "OVERCOMING",
    secondary_pillar: "FAITH",
    editorial_intent: "Identificação emocional rápida para prender atenção e convidar a uma reflexão pessoal.",
    cover_text: "Fé para avançar",
    review_status: "READY_FOR_HUMAN_REVIEW",
    publication_status: "NOT_PUBLISHED",
    publication_priority: "HIGH",
    suggested_context: "Conteúdo evergreen de encorajamento para abrir uma sequência sobre fé em movimento.",
    suggested_spacing: "Manter pelo menos 14 dias antes de outro Reel desta música.",
  },
  MAIN_CHORUS: {
    editorial_title: "Quando as Águas se Abriram — Coragem para Seguir",
    hook_candidates: [
      { category: "OVERCOMING", text: "Nem todo mar diante de você é o fim da estrada." },
      { category: "QUESTION", text: "E se a travessia começar justamente agora?" },
      { category: "EMOTIONAL", text: "Há uma coragem que nasce quando não dá mais para voltar." },
    ],
    selected_hook: "Nem todo mar diante de você é o fim da estrada.",
    caption: "Nem todo mar diante de você é o fim da estrada.\n\nO refrão desta canção carrega a força de quem olha para o impossível sem transformar o medo em morada. A travessia pode ser difícil, mas você não precisa atravessá-la sozinho.\n\nÊxodo 14 nos recorda uma passagem de fé, coragem e confiança na direção de Deus.\n\nCompartilhe com alguém que está tentando seguir em frente.\n\nVargen & Fé\nA Bíblia transformada em música.",
    bible_reference: PILOT_BIBLE_REFERENCE,
    cta: "Compartilhe com alguém que precisa seguir em frente.",
    hashtags: ["#VargenEFé", "#RockCatolico", "#MusicaCatolica", "#Biblia", "#Fe", "#Coragem", "#Exodo"],
    content_pillar: "SCRIPTURE",
    secondary_pillar: "OVERCOMING",
    editorial_intent: "Mensagem bíblica de alta energia, com potencial de compartilhamento por identificação.",
    cover_text: "O mar não é o fim",
    review_status: "READY_FOR_HUMAN_REVIEW",
    publication_status: "NOT_PUBLISHED",
    publication_priority: "HIGH",
    suggested_context: "Reforçar a mensagem bíblica com energia musical e foco em compartilhamentos qualificados.",
    suggested_spacing: "Manter pelo menos 14 dias antes de outro Reel desta música.",
  },
  STORY_BUILD: {
    editorial_title: "Quando as Águas se Abriram — Caminho Depois do Medo",
    hook_candidates: [
      { category: "REFLECTION", text: "Você não precisa voltar para o medo só porque o caminho ainda não apareceu." },
      { category: "CURIOSITY", text: "O que acontece depois que a coragem vence a paralisia?" },
      { category: "SCRIPTURE", text: "A travessia também faz parte da história da fé." },
    ],
    selected_hook: "Você não precisa voltar para o medo só porque o caminho ainda não apareceu.",
    caption: "Você não precisa voltar para o medo só porque o caminho ainda não apareceu.\n\nAlgumas respostas chegam como um caminho aberto; outras começam como uma decisão silenciosa de permanecer firme. Este trecho cresce aos poucos, como quem encontra força para continuar.\n\nA referência é Êxodo 14: uma história de travessia, presença e confiança.\n\nQual passo você está tentando dar nesta estação?\n\nVargen & Fé\nA Bíblia transformada em música.",
    bible_reference: PILOT_BIBLE_REFERENCE,
    cta: "Qual passo você está tentando dar nesta estação? Conte nos comentários.",
    hashtags: ["#VargenEFé", "#MusicaCrista", "#PalavraDeDeus", "#Fe", "#Esperanca", "#Exodo", "#12MesesComDeus"],
    content_pillar: "FAITH",
    secondary_pillar: "MONTHLY_JOURNEY",
    editorial_intent: "Narrativa mais profunda para favorecer retenção, pausa e comentário significativo.",
    cover_text: "Continue avançando",
    review_status: "READY_FOR_HUMAN_REVIEW",
    publication_status: "NOT_PUBLISHED",
    publication_priority: "MEDIUM",
    suggested_context: "Conteúdo contemplativo para aprofundar a jornada mensal sem repetir o foco dos cortes curtos.",
    suggested_spacing: "Manter pelo menos 21 dias antes de outro Reel desta música.",
  },
};

export function generateEditorialPackage(input: { reelId: string; category: CandidateCategory; outputPath: string; rightsStatus: RightsStatus; generatedAt?: string }): EditorialPackage {
  const preset = presets[input.category as keyof typeof presets];
  if (!preset) throw new Error(`EDITORIAL_PRESET_NOT_FOUND: ${input.category}`);
  return {
    ...preset,
    reel_id: input.reelId,
    cover_filename: `${input.outputPath.replace(/^.*[\\/]/, "").replace(/\.mp4$/i, ".cover.jpg")}`,
    cover_path: input.outputPath.replace(/\.mp4$/i, ".cover.jpg"),
    editorial_version: EDITORIAL_VERSION,
    rights_status: input.rightsStatus,
    generated_at: input.generatedAt ?? new Date().toISOString(),
  };
}

export type EditorialValidationOptions = {
  allowHumanBibleReference?: boolean;
};

export function validateEditorialPackage(editorial: EditorialPackage, options: EditorialValidationOptions = {}): string[] {
  const errors: string[] = [];
  if (editorial.selected_hook.length < 15 || editorial.selected_hook.length > 140) errors.push("HOOK_LENGTH_INVALID");
  if (!editorial.caption.startsWith(editorial.selected_hook)) errors.push("CAPTION_MUST_START_WITH_SELECTED_HOOK");
  // Generated pilot packages retain their historical fixed reference. Human
  // review edits may enter another structurally valid reference, but the
  // Bible workflow remains responsible for verification and CONTENT_READY.
  if (!options.allowHumanBibleReference && editorial.bible_reference !== PILOT_BIBLE_REFERENCE) errors.push("BIBLE_REFERENCE_NOT_VERIFIED");
  if (editorial.hashtags.length < 5 || editorial.hashtags.length > 10) errors.push("HASHTAG_COUNT_INVALID");
  if (!editorial.hashtags.includes("#VargenEFé")) errors.push("BRAND_HASHTAG_MISSING");
  if (editorial.rights_status !== "RIGHTS_PENDING_CONFIRMATION" && editorial.rights_status !== "RIGHTS_CONFIRMED") errors.push("RIGHTS_STATUS_CHANGED_UNEXPECTEDLY");
  if (editorial.publication_status !== "NOT_PUBLISHED") errors.push("PUBLICATION_STATUS_NOT_DRY");
  return errors;
}

export function validateEditorialBatch(packages: EditorialPackage[]): string[] {
  const errors: string[] = [];
  const hooks = new Set(packages.map((item) => item.selected_hook));
  const captions = new Set(packages.map((item) => item.caption));
  const ctas = new Set(packages.map((item) => item.cta));
  if (hooks.size !== packages.length) errors.push("DUPLICATE_SELECTED_HOOK");
  if (captions.size !== packages.length) errors.push("DUPLICATE_CAPTION");
  if (ctas.size !== packages.length) errors.push("DUPLICATE_CTA");
  for (const item of packages) errors.push(...validateEditorialPackage(item).map((error) => `${item.reel_id}:${error}`));
  return errors;
}

export function hookCandidatesFor(packageValue: EditorialPackage): HookCandidate[] {
  return packageValue.hook_candidates;
}

export function priorityLabel(priority: PublicationPriority): string {
  return priority;
}
