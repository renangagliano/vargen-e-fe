import type { ProjectEnvironmentSource } from "./index.js";

export type SupabasePublicKeyType = "PUBLISHABLE" | "LEGACY_ANON";
export type SupabaseServerKeyType = "SECRET" | "LEGACY_SERVICE_ROLE";
export type SupabaseConfigSource = ProjectEnvironmentSource;

export type SupabaseConfiguration = {
  url: string;
  projectRef: string;
  publicKey?: string;
  publicKeyType?: SupabasePublicKeyType;
  publicKeyVariable?: string;
  publicKeySource?: SupabaseConfigSource;
  serverSecret?: string;
  serverSecretType?: SupabaseServerKeyType;
  serverSecretVariable?: string;
  serverSecretSource?: SupabaseConfigSource;
};

type Environment = NodeJS.ProcessEnv | Record<string, string | undefined>;
const JWT_KEY_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function valueOf(env: Environment, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

function resolveKey(env: Environment, preferred: string, legacy: string): { value?: string; variable?: string } {
  const preferredValue = valueOf(env, preferred);
  if (preferredValue) return { value: preferredValue, variable: preferred };
  const legacyValue = valueOf(env, legacy);
  return { value: legacyValue, variable: legacyValue ? legacy : undefined };
}

export function classifySupabasePublicKey(key: string): SupabasePublicKeyType {
  if (key.startsWith("sb_secret_")) throw new Error("SUPABASE_PUBLIC_KEY_IS_SECRET");
  if (key.startsWith("sb_publishable_")) return "PUBLISHABLE";
  if (JWT_KEY_PATTERN.test(key)) return "LEGACY_ANON";
  throw new Error("SUPABASE_PUBLIC_KEY_INVALID");
}

export function classifySupabaseServerKey(key: string): SupabaseServerKeyType {
  if (key.startsWith("sb_publishable_")) throw new Error("SUPABASE_SERVER_KEY_IS_PUBLIC");
  if (key.startsWith("sb_secret_")) return "SECRET";
  if (JWT_KEY_PATTERN.test(key)) return "LEGACY_SERVICE_ROLE";
  throw new Error("SUPABASE_SERVER_KEY_INVALID");
}

export function resolveSupabaseConfiguration(env: Environment = process.env): SupabaseConfiguration {
  const url = valueOf(env, "NEXT_PUBLIC_SUPABASE_URL");
  if (!url) throw new Error("SUPABASE_URL_MISSING");
  if (!/^https:\/\/[^\s/]+\.supabase\.co(?:\/[^\s]*)?$/.test(url)) throw new Error("SUPABASE_URL_INVALID");
  const publicKey = resolveKey(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serverSecret = resolveKey(env, "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  const publicKeyType = publicKey.value ? classifySupabasePublicKey(publicKey.value) : undefined;
  const serverSecretType = serverSecret.value ? classifySupabaseServerKey(serverSecret.value) : undefined;
  return {
    url: url.replace(/\/$/, ""),
    projectRef: new URL(url).hostname.split(".")[0],
    publicKey: publicKey.value,
    publicKeyType,
    publicKeyVariable: publicKey.variable,
    serverSecret: serverSecret.value,
    serverSecretType,
    serverSecretVariable: serverSecret.variable,
  };
}
