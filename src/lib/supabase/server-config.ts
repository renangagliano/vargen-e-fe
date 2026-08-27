import { getSupabasePublicConfig } from "./public-config";

export function getSupabaseServerConfig(env: NodeJS.ProcessEnv = process.env) {
  const publicConfig = getSupabasePublicConfig(env);
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return { ...publicConfig, serviceRoleKey };
}

export function requireSupabaseServiceRoleKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = getSupabaseServerConfig(env).serviceRoleKey;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY_MISSING");
  return key;
}

