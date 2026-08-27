import { NextResponse } from "next/server";
import { getAuthenticatedAdminIdentity } from "@vargenfe/admin-shared/admin/server-auth";
import { getAdminRuntimeConfig } from "../../../../lib/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Safe, authenticated diagnostics. No keys or secret-derived values leave the server. */
export async function GET() {
  const identity = await getAuthenticatedAdminIdentity();
  if (!identity) return NextResponse.json({ error: "ADMIN_AUTH_REQUIRED" }, { status: 401 });
  try {
    const config = getAdminRuntimeConfig();
    return NextResponse.json({
      data_source: config.dataSource,
      remote_write_enabled: config.remoteWriteEnabled,
      auto_publish_enabled: config.autoPublishEnabled,
      source_of_value: config.sourceOfValue,
      secrets_exposed: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "ADMIN_RUNTIME_CONFIGURATION_FAILED" }, { status: 503 });
  }
}
