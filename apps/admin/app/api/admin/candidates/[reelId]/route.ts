import { NextResponse } from "next/server";
import { getAuthenticatedAdminIdentity } from "@vargenfe/admin-shared/admin/server-auth";
import { getRemoteRepository } from "../../../../../lib/repository";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ reelId: string }> }) {
  const identity = await getAuthenticatedAdminIdentity();
  if (!identity) return NextResponse.json({ error: "ADMIN_AUTH_REQUIRED" }, { status: 401 });
  const { reelId } = await params;
  if (!/^reel-[a-z0-9-]+$/i.test(reelId)) return NextResponse.json({ error: "INVALID_REEL_ID" }, { status: 400 });
  const detail = await (await getRemoteRepository()).getCandidateDetail(reelId);
  return detail ? NextResponse.json(detail, { headers: { "Cache-Control": "private, no-store" } }) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
