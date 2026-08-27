import { NextResponse } from "next/server";
import { getAuthenticatedAdminIdentity } from "@vargenfe/admin-shared/admin/server-auth";
import {
  assertRemoteMutationEnabled,
  isMutationRoleAllowed,
  parseMutationRequest,
  resolveAutoPublishOnApproval,
} from "@vargenfe/admin-shared/admin/mutation-contract";
import { SupabaseGovernanceMutationRepository } from "@vargenfe/admin-shared/admin/governance-repository";
import { createSupabaseServiceClient } from "@vargenfe/admin-shared/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeError(value: unknown): string {
  return value instanceof Error && /^[A-Z][A-Z0-9_]{3,}$/.test(value.message)
    ? value.message
    : "REMOTE_GOVERNANCE_MUTATION_FAILED";
}

function statusForCode(code: string): number {
  if (["BIBLE_REFERENCE_INVALID", "RIGHTS_CONFIRMATION_REQUIRED", "REQUIRED_EDITORIAL_FIELDS_MISSING", "REJECTION_CONFIRMATION_REQUIRED", "RIGHTS_SOURCE_NOT_FOUND"].includes(code)) return 422;
  if (code === "REMOTE_WRITE_DISABLED" || code === "ADMIN_FORBIDDEN") return 403;
  if (code === "EDITORIAL_VERSION_CONFLICT") return 409;
  return 400;
}

/** Controlled remote governance entry point; browser clients never write. */
export async function POST(request: Request) {
  const identity = await getAuthenticatedAdminIdentity();
  if (!identity) return NextResponse.json({ error: "ADMIN_AUTH_REQUIRED" }, { status: 401 });

  // Check the global write gate before parsing operator input so a disabled
  // endpoint cannot be used as a payload oracle and always fails closed.
  try { assertRemoteMutationEnabled(process.env); } catch { return NextResponse.json({ error: "REMOTE_WRITE_DISABLED" }, { status: 403 }); }

  let input;
  try {
    input = parseMutationRequest(await request.json());
  } catch (error) {
    const code = safeError(error);
    return NextResponse.json({ error: code }, { status: statusForCode(code) });
  }

  try {
    const config = assertRemoteMutationEnabled(process.env);
    if (!isMutationRoleAllowed(input.action, identity.role)) throw new Error("ADMIN_FORBIDDEN");

    // A Vercel request must not guess or reuse local OneDrive/MSAL state. A
    // personal publication worker must be provisioned before this path can
    // authorize an Instagram attempt.
    if (input.action === "approve_editorial" && resolveAutoPublishOnApproval(process.env.INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL)) {
      if (input.confirm_publication !== "I_CONFIRM_APPROVE_AND_PUBLISH") return NextResponse.json({ error: "PUBLICATION_CONFIRMATION_REQUIRED" }, { status: 409 });
      if (process.env.INSTAGRAM_PUBLISH_MODE?.trim() !== "approval" || process.env.INSTAGRAM_REQUIRE_APPROVAL?.trim().toLowerCase() !== "true" || process.env.INSTAGRAM_PILOT_REAL?.trim().toLowerCase() !== "true") return NextResponse.json({ error: "PUBLICATION_CONFIGURATION_BLOCKED" }, { status: 409 });
      return NextResponse.json({ error: "PUBLICATION_WORKER_REQUIRED", remote_write_enabled: config.remoteWriteEnabled }, { status: 409 });
    }

    const repository = new SupabaseGovernanceMutationRepository(createSupabaseServiceClient());
    const result = await repository.execute(input, identity);
    return NextResponse.json({ ...result, remote_write_enabled: true }, { status: 200 });
  } catch (error) {
    const code = safeError(error);
    return NextResponse.json({ error: code }, { status: statusForCode(code) });
  }
}
