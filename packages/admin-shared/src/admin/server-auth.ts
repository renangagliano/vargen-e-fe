import { requireRole, type AdminIdentity } from "./auth.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

export async function getAuthenticatedAdminIdentity(): Promise<AdminIdentity | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") return null;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,role,is_active")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (profileError || !profile || !["ADMIN", "REVIEWER", "VIEWER"].includes(profile.role)) return null;
  return { userId: profile.id, email: profile.email ?? null, role: profile.role };
}

export async function requireAuthenticatedAdmin(allowed: readonly AdminIdentity["role"][] = ["ADMIN", "REVIEWER", "VIEWER"]): Promise<AdminIdentity> {
  return requireRole(await getAuthenticatedAdminIdentity(), allowed);
}
