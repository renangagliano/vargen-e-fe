import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicConfig } from "./public-config.ts";
export async function createSupabaseServerClient() { const cookieStore = await cookies(); const { url, publicKey } = getSupabasePublicConfig(); return createServerClient(url, publicKey, { cookies: { getAll() { return cookieStore.getAll(); }, setAll(values) { try { for (const { name, value, options } of values) cookieStore.set(name, value, options); } catch { /* Server Components cannot write cookies; proxy owns refresh. */ } } } }); }
