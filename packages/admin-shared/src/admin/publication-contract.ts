import type { AdminRole } from "./review-types.ts";

export const PUBLICATION_STATES = ["READY", "PREPARING", "CONTAINER_CREATED", "PROCESSING", "PUBLISHING", "PUBLISHED", "FAILED", "FAILED_PRE_META", "UNCERTAIN"] as const;
export type PublicationState = typeof PUBLICATION_STATES[number];

export type PublicationAnalytics = {
  status: "AVAILABLE" | "UNSUPPORTED" | "NOT_AVAILABLE";
  metrics?: unknown;
  source_timestamp?: string | null;
};

export type AdminPublicationRequest = {
  reel_id: string;
  expected_current_version: number;
  request_id: string;
  confirmed: true;
};

export type PublicationSnapshot = {
  snapshot_id: string;
  snapshot_version: string;
  publication_key: string;
  reel_id: string;
  asset_id: string;
  editorial_version: number;
  title: string;
  caption: string;
  hashtags: string[];
  cta: string;
  bible_reference: string | null;
  rights_status: string;
  content_ready_evaluation_id: string;
  readiness_gates: Record<string, unknown>;
  source_checksum: string;
  derived_checksum: string | null;
  media_relative_path: string;
  media_size: number;
  target_account: string;
  operator_user_id: string;
  operator_role: "ADMIN";
  authorized_at: string;
  request_id: string;
  temporary_media_item_id?: string | null;
  temporary_media_path?: string | null;
  temporary_media_permission_id?: string | null;
};

export type PublicationAttempt = {
  publication_key: string;
  reel_id: string;
  editorial_version: number;
  status: PublicationState;
  attempt_count: number;
  container_id: string | null;
  remote_media_id: string | null;
  permalink: string | null;
  published_at: string | null;
  snapshot: PublicationSnapshot | null;
  cleanup_status: string;
  analytics_status: string;
};

export type PublicationAcquireResult = {
  status: "LOCK_ACQUIRED" | "ALREADY_PUBLISHED" | "ACTIVE_ATTEMPT" | "BLOCKED";
  publication_key: string;
  blockers?: string[];
  attempt?: PublicationAttempt;
  snapshot?: PublicationSnapshot;
};

export function parseAdminPublicationRequest(value: unknown): AdminPublicationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PUBLICATION_PAYLOAD_INVALID");
  const input = value as Record<string, unknown>;
  const reelId = typeof input.reel_id === "string" ? input.reel_id.trim() : "";
  const requestId = typeof input.request_id === "string" ? input.request_id.trim() : "";
  if (!/^reel-[a-z0-9-]+$/i.test(reelId)) throw new Error("INVALID_REEL_ID");
  if (!requestId || requestId.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(requestId)) throw new Error("PUBLICATION_REQUEST_ID_INVALID");
  if (typeof input.expected_current_version !== "number" || !Number.isInteger(input.expected_current_version) || input.expected_current_version < 1) throw new Error("EDITORIAL_VERSION_REQUIRED");
  if (input.confirmed !== true) throw new Error("PUBLICATION_CONFIRMATION_REQUIRED");
  return { reel_id: reelId, expected_current_version: input.expected_current_version, request_id: requestId, confirmed: true };
}

export function canPublish(role: AdminRole, enabled: boolean, contentReady: boolean, publicationStatus: string, activeAttempt: boolean): boolean {
  return role === "ADMIN" && enabled && contentReady && publicationStatus !== "PUBLISHED" && !activeAttempt;
}

export function publicationKey(input: { reelId: string; editorialVersion: number; sourceChecksum: string; mediaPath: string; mediaSize: number; targetAccount: string }): string {
  const identity = `${input.reelId}\n${input.editorialVersion}\n${input.sourceChecksum}\n${input.mediaPath}\n${input.mediaSize}\n${input.targetAccount}`;
  // The key is deterministic for the frozen remote metadata and does not
  // contain a credential or a temporary URL.
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
  return `instagram:${input.reelId}:${input.editorialVersion}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
