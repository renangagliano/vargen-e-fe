import { resolveSupabasePublicConfig, type SupabasePublicKeyType } from "./config.ts";

export type SupabasePublicConfig = {
  url: string;
  publicKey: string;
  publicKeyType: SupabasePublicKeyType;
};

export type SupabasePublicEnvironment = NodeJS.ProcessEnv | Record<string, string | undefined>;

export function getSupabasePublicConfig(env: SupabasePublicEnvironment): SupabasePublicConfig {
  const config = resolveSupabasePublicConfig(env);
  return { url: config.url, publicKey: config.publicKey, publicKeyType: config.publicKeyType };
}

export function getSupabaseBrowserPublicConfig(): SupabasePublicConfig {
  return getSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}
