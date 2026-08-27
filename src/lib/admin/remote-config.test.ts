import assert from "node:assert/strict";
import test from "node:test";
import { resolveAdminDataSource, resolveRemoteAdminConfig } from "./remote-config.ts";

test("remote admin configuration is read-only and fail-closed by default", () => {
  assert.deepEqual(resolveRemoteAdminConfig({}), { dataSource: "sqlite", remoteWriteEnabled: false });
  assert.deepEqual(resolveRemoteAdminConfig({ ADMIN_DATA_SOURCE: "supabase-readonly", ADMIN_REMOTE_WRITE_ENABLED: "false" }), { dataSource: "supabase-readonly", remoteWriteEnabled: false });
  assert.throws(() => resolveRemoteAdminConfig({ ADMIN_REMOTE_WRITE_ENABLED: "yes" }), /ADMIN_REMOTE_WRITE_ENABLED_INVALID/);
  assert.throws(() => resolveRemoteAdminConfig({ ADMIN_REMOTE_WRITE_ENABLED: "true", ADMIN_DATA_SOURCE: "sqlite" }), /ADMIN_REMOTE_WRITE_REQUIRES_SUPABASE/);
  assert.deepEqual(resolveRemoteAdminConfig({ ADMIN_DATA_SOURCE: "supabase", ADMIN_REMOTE_WRITE_ENABLED: "true" }), { dataSource: "supabase", remoteWriteEnabled: true });
  assert.throws(() => resolveRemoteAdminConfig({ ADMIN_DATA_SOURCE: "supabase" }), /ADMIN_DATA_SOURCE_REQUIRES_REMOTE_WRITE/);
});
