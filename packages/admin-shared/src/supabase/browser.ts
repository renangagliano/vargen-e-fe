"use client";
import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "./public-config.ts";
export function createSupabaseBrowserClient() { const { url, publicKey } = getSupabasePublicConfig(); return createBrowserClient(url, publicKey); }
