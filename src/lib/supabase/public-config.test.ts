import assert from "node:assert/strict";
import test from "node:test";
import { getSupabasePublicConfig } from "./public-config.ts";

test("Supabase public configuration requires a project URL and public key", () => {
  assert.throws(() => getSupabasePublicConfig({}), /SUPABASE_PUBLIC_CONFIG_MISSING/);
  assert.deepEqual(getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://personal.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key" }), { url: "https://personal.supabase.co", anonKey: "public-key" });
  assert.throws(() => getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://example.com", NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key" }), /SUPABASE_URL_INVALID/);
});
