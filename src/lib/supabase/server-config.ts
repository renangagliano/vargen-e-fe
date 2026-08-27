import { getSupabasePublicConfig, type SupabasePublicConfig } from "./public-config.ts";

export type SupabaseServerKeyType = "SECRET" | "LEGACY_SERVICE_ROLE";
export type SupabaseServerConfig = SupabasePublicConfig & { serverSecret?: string; serverSecretType?: SupabaseServerKeyType };

const JWT_KEY_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
type Environment = NodeJS.ProcessEnv | Record<string, string | undefined>;

export function classifySupabaseServerKey(key: string): SupabaseServerKeyType {
  if (key.startsWith("sb_publishable_")) throw new Error("SUPABASE_SERVER_KEY_IS_PUBLIC");
  if (key.startsWith("sb_secret_")) return "SECRET";
  if (JWT_KEY_PATTERN.test(key)) return "LEGACY_SERVICE_ROLE";
  throw new Error("SUPABASE_SERVER_KEY_INVALID");
}

export function getSupabaseServerConfig(env: Environment = process.env): SupabaseServerConfig {
  const publicConfig = getSupabasePublicConfig(env);
  const serverSecret = env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined;
  return { ...publicConfig, serverSecret, serverSecretType: serverSecret ? classifySupabaseServerKey(serverSecret) : undefined };
}

export function requireSupabaseServiceRoleKey(env: Environment = process.env): string {
  const key = getSupabaseServerConfig(env).serverSecret;
  if (!key) throw new Error("SUPABASE_SERVER_SECRET_MISSING");
  return key;
}

export const requireSupabaseServerSecret = requireSupabaseServiceRoleKey;
