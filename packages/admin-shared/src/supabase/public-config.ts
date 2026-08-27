import { resolveSupabasePublicConfig, type SupabasePublicKeyType } from "./config.ts";
export type SupabasePublicConfig = { url: string; publicKey: string; publicKeyType: SupabasePublicKeyType };
export function getSupabasePublicConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): SupabasePublicConfig { const config = resolveSupabasePublicConfig(env); return { url: config.url, publicKey: config.publicKey, publicKeyType: config.publicKeyType }; }
