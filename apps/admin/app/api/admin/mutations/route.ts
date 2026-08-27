import { NextResponse } from "next/server";
import { getAuthenticatedAdminIdentity } from "../../../../../../src/lib/admin/server-auth";
import { assertRemoteReadOnly } from "../../../../../../src/lib/admin/remote-readonly";

export const runtime = "nodejs";

export async function POST() {
  if (!await getAuthenticatedAdminIdentity()) return NextResponse.json({ error: "ADMIN_AUTH_REQUIRED" }, { status: 401 });
  try { assertRemoteReadOnly(process.env); } catch { return NextResponse.json({ error: "REMOTE_WRITE_DISABLED" }, { status: 403 }); }
  return NextResponse.json({ error: "REMOTE_WRITE_DISABLED" }, { status: 403 });
}
