import assert from "node:assert/strict";
import test from "node:test";
import { collectRemoteSupabaseValidation } from "../src/cli/remote-migration.js";

const env = {
  ADMIN_DATA_SOURCE: "supabase-readonly",
  ADMIN_REMOTE_WRITE_ENABLED: "false",
  NEXT_PUBLIC_SUPABASE_URL: "https://vargen-fe.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public",
  SUPABASE_SECRET_KEY: "sb_secret_server",
};

function response(status: number, body: unknown = [], headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function schemaPresentFetch(options: { admin: boolean } = { admin: true }): typeof fetch {
  return (async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/health")) return response(200, { healthy: true });
    if (url.endsWith("/rest/v1/")) return response(401, { message: "authentication required" });
    if (url.includes("/profiles?select=id&role=eq.ADMIN")) return response(200, options.admin ? [{ id: "admin-id" }] : []);
    if (url.includes("/profiles?select=id&limit=1")) return response(403, { message: "denied" });
    return response(200, [], { "content-range": "*/0" });
  }) as typeof fetch;
}

test("remote validation separates healthy services, applied schema, ADMIN profile and empty data", async () => {
  const result = await collectRemoteSupabaseValidation(env, schemaPresentFetch());
  assert.equal(result.status, "CONNECTED_SCHEMA_PRESENT");
  assert.equal(result.validation_status, "REMOTE_VALIDATION_PASS");
  assert.equal(result.auth, "PASS");
  assert.equal(result.rest, "PASS");
  assert.equal(result.schema, "PRESENT");
  assert.equal(result.admin_profile, "PASS");
  assert.equal(result.data_state, "EMPTY");
  assert.equal(result.migration_state, "NOT_APPLIED");
  assert.equal(result.remote_write_enabled, false);
});

test("schema absence is not classified as authentication failure", async () => {
  const fetchImpl = (async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/health")) return response(200);
    if (url.endsWith("/rest/v1/")) return response(401);
    return response(404);
  }) as typeof fetch;
  const result = await collectRemoteSupabaseValidation(env, fetchImpl);
  assert.equal(result.status, "SCHEMA_NOT_APPLIED");
  assert.notEqual(result.status, "AUTH_CONFIGURATION_FAILED");
});

test("missing ADMIN profile is reported independently", async () => {
  const result = await collectRemoteSupabaseValidation(env, schemaPresentFetch({ admin: false }));
  assert.equal(result.status, "ADMIN_PROFILE_NOT_FOUND");
  assert.equal(result.admin_profile, "NOT_FOUND");
});

test("server validation fails as configuration when the privileged key is public", async () => {
  const result = await collectRemoteSupabaseValidation({ ...env, SUPABASE_SECRET_KEY: "sb_publishable_wrong" }, schemaPresentFetch());
  assert.equal(result.status, "CONFIGURATION_FAILED");
  assert.equal(result.remote_write_enabled, false);
});
