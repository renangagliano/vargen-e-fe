import assert from "node:assert/strict";
import test from "node:test";
import { classifySupabasePublicKey, classifySupabaseServerKey, resolveSupabaseConfiguration } from "../src/config/supabase.js";

test("modern Supabase keys resolve before legacy compatibility keys", () => {
  const config = resolveSupabaseConfiguration({
    NEXT_PUBLIC_SUPABASE_URL: "https://vargen-fe.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_modern",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "a.b.c",
    SUPABASE_SECRET_KEY: "sb_secret_modern",
    SUPABASE_SERVICE_ROLE_KEY: "d.e.f",
  });
  assert.equal(config.publicKey, "sb_publishable_modern");
  assert.equal(config.publicKeyType, "PUBLISHABLE");
  assert.equal(config.serverSecret, "sb_secret_modern");
  assert.equal(config.serverSecretType, "SECRET");
});

test("legacy Supabase key names remain supported", () => {
  const config = resolveSupabaseConfiguration({ NEXT_PUBLIC_SUPABASE_URL: "https://vargen-fe.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "a.b.c", SUPABASE_SERVICE_ROLE_KEY: "d.e.f" });
  assert.equal(config.publicKeyType, "LEGACY_ANON");
  assert.equal(config.serverSecretType, "LEGACY_SERVICE_ROLE");
});

test("modern key types cannot be placed in the wrong slot", () => {
  assert.throws(() => classifySupabasePublicKey("sb_secret_wrong"), /SUPABASE_PUBLIC_KEY_IS_SECRET/);
  assert.throws(() => classifySupabaseServerKey("sb_publishable_wrong"), /SUPABASE_SERVER_KEY_IS_PUBLIC/);
  assert.equal(classifySupabasePublicKey("sb_publishable_ok"), "PUBLISHABLE");
  assert.equal(classifySupabaseServerKey("sb_secret_ok"), "SECRET");
});
