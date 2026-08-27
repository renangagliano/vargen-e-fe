export type SupabasePublicConfig = {
  url: string;
  anonKey: string;
};

export function getSupabasePublicConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): SupabasePublicConfig {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) throw new Error("SUPABASE_PUBLIC_CONFIG_MISSING");
  if (!/^https:\/\/[^\s/]+\.supabase\.co(?:\/[^\s]*)?$/.test(url)) throw new Error("SUPABASE_URL_INVALID");
  return { url, anonKey };
}
