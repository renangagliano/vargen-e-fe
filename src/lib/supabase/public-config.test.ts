import assert from "node:assert/strict";
import test from "node:test";
import { classifySupabasePublicKey } from "./config.ts";
import { getSupabasePublicConfig } from "./public-config.ts";

test("Supabase public configuration requires a project URL and public key", () => {
  assert.throws(() => getSupabasePublicConfig({}), /SUPABASE_URL_MISSING/);
  assert.deepEqual(getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://personal.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public-key" }), { url: "https://personal.supabase.co", publicKey: "sb_publishable_public-key", publicKeyType: "PUBLISHABLE" });
  assert.deepEqual(getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://personal.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "a.b.c" }), { url: "https://personal.supabase.co", publicKey: "a.b.c", publicKeyType: "LEGACY_ANON" });
  assert.throws(() => getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://example.com", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public-key" }), /SUPABASE_URL_INVALID/);
});

test("modern public key takes precedence over legacy anon key", () => {
  const config = getSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_URL: "https://personal.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_modern-public",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "a.b.c",
  });
  assert.equal(config.publicKey, "sb_publishable_modern-public");
  assert.equal(config.publicKeyType, "PUBLISHABLE");
});

test("server secret cannot be configured as a browser public key", () => {
  assert.throws(() => classifySupabasePublicKey("sb_secret_wrong"), /SUPABASE_PUBLIC_KEY_IS_SECRET/);
});
