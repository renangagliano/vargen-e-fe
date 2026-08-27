"use client";
import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseBrowserPublicConfig } from "./public-config.ts";
export function createSupabaseBrowserClient() { const { url, publicKey } = getSupabaseBrowserPublicConfig(); return createBrowserClient(url, publicKey); }
