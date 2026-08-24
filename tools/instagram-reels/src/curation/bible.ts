import type { BibleReferenceStatus, EditorialPackage } from "../shared/types.js";

export type BibleResolution = {
  status: BibleReferenceStatus;
  reference: string | null;
  evidence: string;
};

export function normalizeBibleReference(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").replace(/\s*[-–—]\s*/g, "-").trim();
}

/**
 * Resolves only evidence already present in the editorial package. The local
 * song catalog currently exposes no scripture entries, so an empty package
 * remains MISSING rather than being inferred from a title or collection.
 */
export function resolveBibleReference(editorial: EditorialPackage | undefined, authoritativeReference?: string | null): BibleResolution {
  if (editorial?.bible_reference?.trim() && authoritativeReference?.trim() && normalizeBibleReference(editorial.bible_reference) !== normalizeBibleReference(authoritativeReference)) {
    return { status: "CONFLICT", reference: normalizeBibleReference(editorial.bible_reference), evidence: "O pacote e a fonte autoritativa local apresentam referências diferentes; revisão humana obrigatória." };
  }
  if (!editorial?.bible_reference?.trim() && authoritativeReference?.trim()) {
    return { status: "VERIFIED", reference: normalizeBibleReference(authoritativeReference), evidence: "Referência preservada de fonte autoritativa local fornecida pelo chamador." };
  }
  if (!editorial?.bible_reference?.trim()) return { status: "MISSING", reference: null, evidence: "Nenhuma referência bíblica autoritativa encontrada no pacote ou catálogo local." };
  const reference = normalizeBibleReference(editorial.bible_reference);
  if (editorial.bible_reference_review_required) return { status: "INFERRED_REVIEW_REQUIRED", reference, evidence: "Referência presente, mas marcada pelo pacote para revisão humana." };
  return { status: "VERIFIED", reference, evidence: "Referência preservada de pacote editorial previamente validado." };
}
