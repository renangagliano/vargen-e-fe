import type { AdminRole, ReviewStatus } from "./review-types.ts";
import { resolveRemoteAdminConfig, type RemoteAdminConfig } from "./remote-config.ts";

export const AUTO_PUBLISH_CONFIRMATION = "I_CONFIRM_APPROVE_AND_PUBLISH";

export type GovernanceMutationAction =
  | "save_editorial"
  | "confirm_rights"
  | "approve_editorial"
  | "needs_changes"
  | "reject";

export type EditorialMutationFields = {
  title?: string;
  hook?: string;
  caption?: string;
  cta?: string;
  hashtags?: string[];
  primary_pillar?: string;
  secondary_pillar?: string | null;
  cover_text?: string;
  bible_reference?: string;
  operator_note?: string | null;
};

export type GovernanceMutationRequest = {
  action: GovernanceMutationAction;
  reel_id: string;
  expected_current_version: number;
  request_id: string;
  fields?: EditorialMutationFields;
  confirmation_statement?: string;
  confirm_publication?: string;
  confirm_rejection?: boolean;
};

export type PublicationAuthorizationEvidence = {
  operator_user_id: string;
  operator_role: "ADMIN";
  approved_at: string;
  reel_id: string;
  editorial_version: number;
  publication_key: string;
  request_id: string;
};

const ACTIONS: readonly GovernanceMutationAction[] = [
  "save_editorial", "confirm_rights",
  "approve_editorial", "needs_changes", "reject",
];

export function isGovernanceMutationAction(value: unknown): value is GovernanceMutationAction {
  return typeof value === "string" && ACTIONS.includes(value as GovernanceMutationAction);
}

export function resolveAutoPublishOnApproval(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "false") return false;
  if (normalized === "true") return true;
  throw new Error("INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL_INVALID");
}

export function mutationAllowedRoles(action: GovernanceMutationAction): readonly AdminRole[] {
  if (action === "confirm_rights" || action === "approve_editorial") return ["ADMIN"];
  return ["ADMIN", "REVIEWER"];
}

export function isMutationRoleAllowed(action: GovernanceMutationAction, role: AdminRole): boolean {
  return mutationAllowedRoles(action).includes(role);
}

export function assertRemoteMutationEnabled(configOrEnv: RemoteAdminConfig | NodeJS.ProcessEnv | Record<string, string | undefined>): RemoteAdminConfig {
  const config = "dataSource" in configOrEnv && "remoteWriteEnabled" in configOrEnv
    ? configOrEnv as RemoteAdminConfig
    : resolveRemoteAdminConfig(configOrEnv);
  if (config.dataSource !== "supabase" || !config.remoteWriteEnabled) throw new Error("REMOTE_WRITE_DISABLED");
  return config;
}

export function parseMutationRequest(value: unknown): GovernanceMutationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MUTATION_PAYLOAD_INVALID");
  const input = value as Record<string, unknown>;
  if (!isGovernanceMutationAction(input.action)) throw new Error("MUTATION_ACTION_INVALID");
  const reelId = typeof input.reel_id === "string" ? input.reel_id.trim() : "";
  const requestId = typeof input.request_id === "string" ? input.request_id.trim() : "";
  const version = input.expected_current_version;
  if (!reelId || reelId.length > 200) throw new Error("MUTATION_REEL_ID_REQUIRED");
  if (!requestId || requestId.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(requestId)) throw new Error("MUTATION_REQUEST_ID_INVALID");
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new Error("EDITORIAL_VERSION_REQUIRED");

  const fields = input.fields;
  if (fields !== undefined && (!fields || typeof fields !== "object" || Array.isArray(fields))) throw new Error("EDITORIAL_FIELDS_INVALID");
  const result: GovernanceMutationRequest = {
    action: input.action,
    reel_id: reelId,
    expected_current_version: version,
    request_id: requestId,
  };
  if (fields) result.fields = normalizeEditorialFields(fields as Record<string, unknown>);
  for (const key of ["confirmation_statement", "confirm_publication"] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "string" || input[key].length > 4000) throw new Error(`MUTATION_${key.toUpperCase()}_INVALID`);
      result[key] = input[key].trim();
    }
  }
  if (input.confirm_rejection !== undefined) {
    if (typeof input.confirm_rejection !== "boolean") throw new Error("MUTATION_CONFIRM_REJECTION_INVALID");
    result.confirm_rejection = input.confirm_rejection;
  }
  validateMutationActionPayload(result);
  return result;
}

const RIGHTS_CONFIRMATION_STATEMENT = "I confirm that I have the necessary rights or authorization to use and publish this media for the Vargen & Fé project.";

export function validateMutationActionPayload(request: GovernanceMutationRequest): void {
  if (request.action === "save_editorial" && request.fields?.bible_reference) {
    if (!isBibleReferenceStructurallyValid(request.fields.bible_reference)) throw new Error("BIBLE_REFERENCE_INVALID");
  }
  if (request.action === "confirm_rights") {
    if (request.confirmation_statement !== RIGHTS_CONFIRMATION_STATEMENT) throw new Error("RIGHTS_CONFIRMATION_REQUIRED");
  }
  if (request.action === "reject" && request.confirm_rejection !== true) {
    throw new Error("REJECTION_CONFIRMATION_REQUIRED");
  }
}

export { RIGHTS_CONFIRMATION_STATEMENT };

/** Syntax-only validation. It confirms a reference shape, never Bible content. */
export function isBibleReferenceStructurallyValid(value: string): boolean {
  const reference = value.replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").replace(/\s*:\s*/g, ":").replace(/\s*[-–—]\s*/g, "-").trim();
  return reference.length > 0 && reference.length <= 120
    && /^(?:(?:[1-3]\s+)?[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+)*)\s+\d+(?::\d+(?:-\d+)?|,\d+(?:-\d+)?(?:\.\d+(?:-\d+)?)*)?$/u.test(reference);
}

function normalizeEditorialFields(input: Record<string, unknown>): EditorialMutationFields {
  const fields: EditorialMutationFields = {};
  const stringKeys = ["title", "hook", "caption", "cta", "primary_pillar", "cover_text", "bible_reference", "operator_note"] as const;
  for (const key of stringKeys) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "string" || input[key].length > 20000) throw new Error(`EDITORIAL_${key.toUpperCase()}_INVALID`);
      fields[key] = input[key].trim();
    }
  }
  if (input.secondary_pillar !== undefined) {
    if (input.secondary_pillar !== null && typeof input.secondary_pillar !== "string") throw new Error("EDITORIAL_SECONDARY_PILLAR_INVALID");
    fields.secondary_pillar = typeof input.secondary_pillar === "string" ? input.secondary_pillar.trim() || null : null;
  }
  if (input.hashtags !== undefined) {
    if (!Array.isArray(input.hashtags) || input.hashtags.length > 100 || input.hashtags.some((tag) => typeof tag !== "string" || tag.length > 200)) throw new Error("EDITORIAL_HASHTAGS_INVALID");
    fields.hashtags = input.hashtags.map((tag) => tag.trim()).filter(Boolean);
  }
  return fields;
}

export function assertPublicationConfirmation(value: string | undefined): void {
  if (value !== AUTO_PUBLISH_CONFIRMATION) throw new Error("PUBLICATION_CONFIRMATION_REQUIRED");
}

export function approvalProducesPublicationAuthorization(input: {
  autoPublishOnApproval: boolean;
  publishMode: "dry-run" | "approval";
  requireApproval: boolean;
  realPilotEnabled: boolean;
  contentReady: boolean;
  role: AdminRole;
  confirmation?: string;
}): boolean {
  if (!input.autoPublishOnApproval || input.publishMode !== "approval" || !input.requireApproval || !input.realPilotEnabled) return false;
  if (input.role !== "ADMIN" || !input.contentReady) return false;
  return input.confirmation === AUTO_PUBLISH_CONFIRMATION;
}

export function reviewStatusForAction(action: GovernanceMutationAction): ReviewStatus | null {
  if (action === "approve_editorial") return "APPROVED";
  if (action === "needs_changes") return "NEEDS_CHANGES";
  if (action === "reject") return "REJECTED";
  return null;
}
