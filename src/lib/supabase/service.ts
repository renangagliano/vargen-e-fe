import { createClient } from "@supabase/supabase-js";
import { getSupabaseServerConfig, requireSupabaseServiceRoleKey } from "./server-config";

/** Server-only. Never import this module from a Client Component. */
export function createSupabaseServiceClient() {
  const { url } = getSupabaseServerConfig();
  const serverSecret = requireSupabaseServiceRoleKey();
  return createClient(url, serverSecret, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
}
