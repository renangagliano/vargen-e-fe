export type ReviewUiStatusTone = "good" | "warning" | "danger" | "neutral";

const STATUS_LABELS: Record<string, string> = {
  PASS: "Pass",
  APPROVED: "Approved",
  PUBLISHED: "Published",
  VERIFIED: "Verified",
  READY_FOR_HUMAN_REVIEW: "Human review",
  REVIEW_REQUIRED: "Review required",
  RIGHTS_PENDING_CONFIRMATION: "Pending",
  RIGHTS_CONFIRMED: "Confirmed",
  NEEDS_CHANGES: "Needs changes",
  NOT_PUBLISHED: "Not published",
  MISSING: "Missing",
  BLOCKED: "Blocked",
  REJECTED: "Rejected",
  UNSUPPORTED: "Unsupported",
  NOT_AVAILABLE: "Not available",
};

export function formatReviewStatus(value: string | null | undefined): string {
  const normalized = String(value ?? "PENDING").trim().toUpperCase();
  return STATUS_LABELS[normalized] ?? normalized.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function reviewStatusTone(value: string | null | undefined): ReviewUiStatusTone {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (["PASS", "APPROVED", "PUBLISHED", "VERIFIED", "RIGHTS_CONFIRMED"].includes(normalized)) return "good";
  if (["REVIEW_REQUIRED", "READY_FOR_HUMAN_REVIEW", "RIGHTS_PENDING_CONFIRMATION", "NEEDS_CHANGES"].includes(normalized)) return "warning";
  if (["BLOCKED", "REJECTED", "CONFLICT", "ERROR"].includes(normalized)) return "danger";
  return "neutral";
}

export function candidateDetailUrl(endpoint: string, reelId: string): string {
  return `${endpoint.replace(/\/$/, "")}/${encodeURIComponent(reelId)}`;
}

export async function fetchCandidateDetail(endpoint: string, reelId: string, request = fetch): Promise<Record<string, unknown>> {
  const response = await request(candidateDetailUrl(endpoint, reelId), { credentials: "same-origin", headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new Error(objectErrorCode(body) ?? "CANDIDATE_DETAIL_FAILED");
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("CANDIDATE_DETAIL_INVALID");
  return body as Record<string, unknown>;
}

function objectErrorCode(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" ? error : null;
}
