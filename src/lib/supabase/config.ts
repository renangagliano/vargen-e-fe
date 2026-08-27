export type SupabasePublicKeyType = "PUBLISHABLE" | "LEGACY_ANON";

export type SupabasePublicConfig = {
  url: string;
  publicKey: string;
  publicKeyType: SupabasePublicKeyType;
};

type Environment = NodeJS.ProcessEnv | Record<string, string | undefined>;

const JWT_KEY_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function valueOf(env: Environment, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

function validateUrl(value: string): string {
  if (!/^https:\/\/[^\s/]+\.supabase\.co(?:\/[^\s]*)?$/.test(value)) throw new Error("SUPABASE_URL_INVALID");
  return value.replace(/\/$/, "");
}

function resolvePublicKey(env: Environment): string | undefined {
  const preferredValue = valueOf(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (preferredValue) return preferredValue;
  return valueOf(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export function classifySupabasePublicKey(key: string): SupabasePublicKeyType {
  if (key.startsWith("sb_secret_")) throw new Error("SUPABASE_PUBLIC_KEY_IS_SECRET");
  if (key.startsWith("sb_publishable_")) return "PUBLISHABLE";
  if (JWT_KEY_PATTERN.test(key)) return "LEGACY_ANON";
  throw new Error("SUPABASE_PUBLIC_KEY_INVALID");
}

export function resolveSupabasePublicConfig(env: Environment = process.env): SupabasePublicConfig {
  const url = valueOf(env, "NEXT_PUBLIC_SUPABASE_URL");
  if (!url) throw new Error("SUPABASE_URL_MISSING");
  const publicKey = resolvePublicKey(env);
  if (!publicKey) throw new Error("SUPABASE_PUBLIC_KEY_MISSING");
  const publicKeyType = classifySupabasePublicKey(publicKey);
  return { url: validateUrl(url), publicKey, publicKeyType };
}

export function supabaseProjectReference(url: string): string {
  return new URL(url).hostname.split(".")[0];
}
