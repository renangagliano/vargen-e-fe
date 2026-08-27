import assert from "node:assert/strict";
import test from "node:test";
import { classifySupabaseServerKey, getSupabaseServerConfig } from "./server-config.ts";

test("modern server secret takes precedence over legacy service role", () => {
  const config = getSupabaseServerConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://personal.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public", SUPABASE_SECRET_KEY: "sb_secret_modern-server", SUPABASE_SERVICE_ROLE_KEY: "d.e.f" });
  assert.equal(config.serverSecret, "sb_secret_modern-server");
  assert.equal(config.serverSecretType, "SECRET");
});

test("legacy service-role key remains supported and public keys cannot be server secrets", () => {
  const config = getSupabaseServerConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://personal.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "a.b.c", SUPABASE_SERVICE_ROLE_KEY: "d.e.f" });
  assert.equal(config.serverSecretType, "LEGACY_SERVICE_ROLE");
  assert.throws(() => classifySupabaseServerKey("sb_publishable_wrong"), /SUPABASE_SERVER_KEY_IS_PUBLIC/);
});
