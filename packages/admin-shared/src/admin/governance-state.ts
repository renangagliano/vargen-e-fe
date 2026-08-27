export type EffectiveBibleStatus = "VERIFIED" | "REVIEW_REQUIRED" | "MISSING";
export type EffectiveRightsStatus = "RIGHTS_CONFIRMED" | "RIGHTS_PENDING_CONFIRMATION" | "MISSING";

export function resolveEffectiveBibleStatus(input: {
  reference?: unknown;
  evidenceStatus?: unknown;
  evidenceVersion?: unknown;
  verificationVersion?: unknown;
  editorialVersion?: unknown;
}): EffectiveBibleStatus {
  if (typeof input.reference !== "string" || !input.reference.trim()) return "MISSING";
  if (input.evidenceStatus === "VERIFIED"
    && input.evidenceVersion === input.editorialVersion
    && input.verificationVersion === input.editorialVersion) return "VERIFIED";
  return "REVIEW_REQUIRED";
}

export function resolveEffectiveRightsStatus(input: {
  sourceExists: boolean;
  confirmationStatuses?: readonly unknown[];
}): EffectiveRightsStatus {
  if (input.confirmationStatuses?.some((status) => status === "RIGHTS_CONFIRMED")) return "RIGHTS_CONFIRMED";
  return input.sourceExists ? "RIGHTS_PENDING_CONFIRMATION" : "MISSING";
}
