import { NextResponse } from "next/server";
import { getAuthenticatedAdminIdentity } from "@vargenfe/admin-shared/admin/server-auth";
import { parseAdminPublicationRequest, publicationKey } from "@vargenfe/admin-shared/admin/publication-contract";
import { executeAdminPublication, PublicationPipelineError } from "@vargenfe/admin-shared/admin/publication-orchestrator";
import { SupabasePublicationRepository } from "@vargenfe/admin-shared/admin/publication-repository";
import { createSupabaseServiceClient } from "@vargenfe/admin-shared/supabase/service";
import { getAdminRuntimeConfig } from "../../../../lib/runtime-config";
import { AdminMetaPublicationClient } from "../../../../lib/publication/meta";
import { OneDrivePublicationMediaGateway } from "../../../../lib/publication/onedrive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function statusFor(code: string): number {
  if (["ADMIN_AUTH_REQUIRED", "ADMIN_PROFILE_INVALID"].includes(code)) return 401;
  if (["ADMIN_FORBIDDEN", "INSTAGRAM_PUBLISHING_DISABLED", "REMOTE_WRITE_DISABLED"].includes(code)) return 403;
  if (["EDITORIAL_VERSION_CONFLICT", "PUBLICATION_STATE_UNCERTAIN", "ALREADY_PUBLISHED"].includes(code)) return 409;
  if (["PUBLICATION_NOT_READY", "TEMP_MEDIA_VALIDATION_FAILED", "ONEDRIVE_AUTH_REQUIRED", "META_CONFIGURATION_REQUIRED", "PUBLICATION_CONFIRMATION_REQUIRED"].includes(code)) return 422;
  return 500;
}

function safeError(value: unknown): { code: string; details?: Record<string, unknown> } {
  if (value instanceof PublicationPipelineError) return { code: value.code, details: value.details };
  if (value && typeof value === "object" && "code" in value && typeof (value as { code?: unknown }).code === "string" && /^[A-Z][A-Z0-9_]{3,}$/.test((value as { code: string }).code)) return { code: (value as { code: string }).code };
  if (value instanceof Error && /^[A-Z][A-Z0-9_]{3,}$/.test(value.message)) return { code: value.message };
  return { code: "PUBLICATION_FAILED" };
}

export async function POST(request: Request) {
  const identity = await getAuthenticatedAdminIdentity();
  if (!identity) return NextResponse.json({ error: "ADMIN_AUTH_REQUIRED" }, { status: 401 });
  if (identity.role !== "ADMIN") return NextResponse.json({ error: "ADMIN_FORBIDDEN" }, { status: 403 });
  let config;
  try { config = getAdminRuntimeConfig(); } catch { return NextResponse.json({ error: "ADMIN_RUNTIME_CONFIGURATION_FAILED" }, { status: 503 }); }
  if (config.dataSource !== "supabase" || !config.remoteWriteEnabled) return NextResponse.json({ error: "REMOTE_WRITE_DISABLED" }, { status: 403 });
  if (!config.publishingEnabled) return NextResponse.json({ error: "INSTAGRAM_PUBLISHING_DISABLED" }, { status: 403 });
  let input;
  try { input = parseAdminPublicationRequest(await request.json()); }
  catch (error) { const result = safeError(error); return NextResponse.json({ error: result.code }, { status: statusFor(result.code) }); }
  try {
    const client = createSupabaseServiceClient();
    const { data: reel, error: reelError } = await client.from("derived_reels").select("reel_id,output_relative_path,file_size,source_checksum_after,source_checksum_before,publication_status").eq("reel_id", input.reel_id).maybeSingle();
    if (reelError) throw new Error("REMOTE_PUBLICATION_READ_FAILED");
    if (!reel) throw new Error("REEL_NOT_FOUND");
    const sourceChecksum = String(reel.source_checksum_after ?? reel.source_checksum_before ?? "");
    const mediaPath = String(reel.output_relative_path ?? "");
    const mediaSize = Number(reel.file_size ?? 0);
    const targetAccount = process.env.INSTAGRAM_ACCOUNT_ID?.trim();
    if (!targetAccount || !sourceChecksum || !mediaPath || !Number.isFinite(mediaSize) || mediaSize <= 0) throw new Error("PUBLICATION_METADATA_INCOMPLETE");
    const key = publicationKey({ reelId: input.reel_id, editorialVersion: input.expected_current_version, sourceChecksum, mediaPath, mediaSize, targetAccount });
    const repository = new SupabasePublicationRepository(client);
    const result = await executeAdminPublication({ repository, media: new OneDrivePublicationMediaGateway(), meta: new AdminMetaPublicationClient(), actor: identity, requestId: input.request_id, reelId: input.reel_id, expectedVersion: input.expected_current_version, publicationKey: key, targetAccount });
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const result = safeError(error);
    return NextResponse.json({ error: result.code, ...(result.details ? { details: result.details } : {}) }, { status: statusFor(result.code) });
  }
}
