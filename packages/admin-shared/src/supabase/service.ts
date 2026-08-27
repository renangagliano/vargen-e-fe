import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveSupabasePublicConfig } from "./config.ts";

type Environment = NodeJS.ProcessEnv | Record<string, string | undefined>;

function serverSecret(env: Environment): string {
  const value = env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!value) throw new Error("SUPABASE_SERVER_SECRET_MISSING");
  if (value.startsWith("sb_publishable_")) throw new Error("SUPABASE_SERVER_KEY_IS_PUBLIC");
  if (value.startsWith("sb_secret_") || /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return value;
  throw new Error("SUPABASE_SERVER_KEY_INVALID");
}

/** Server-only privileged client. Never import from a Client Component. */
export function createSupabaseServiceClient(env: Environment = process.env): SupabaseClient {
  if (typeof window !== "undefined") throw new Error("SUPABASE_SERVICE_CLIENT_SERVER_ONLY");
  const { url } = resolveSupabasePublicConfig(env);
  return createClient(url, serverSecret(env), { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
}
