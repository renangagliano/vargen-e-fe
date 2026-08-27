import assert from "node:assert/strict";
import test from "node:test";
import { resolveAdminDataSource, resolveAdminRuntimeConfig, resolveRemoteAdminConfig } from "./remote-config.ts";

test("remote admin configuration is read-only and fail-closed by default", () => {
  assert.deepEqual(resolveRemoteAdminConfig({}), { dataSource: "supabase-readonly", remoteWriteEnabled: false });
  assert.deepEqual(resolveRemoteAdminConfig({ ADMIN_DATA_SOURCE: "supabase-readonly", ADMIN_REMOTE_WRITE_ENABLED: "false" }), { dataSource: "supabase-readonly", remoteWriteEnabled: false });
  assert.throws(() => resolveRemoteAdminConfig({ ADMIN_REMOTE_WRITE_ENABLED: "yes" }), /ADMIN_REMOTE_WRITE_ENABLED_INVALID/);
  assert.throws(() => resolveRemoteAdminConfig({ ADMIN_REMOTE_WRITE_ENABLED: "true", ADMIN_DATA_SOURCE: "sqlite" }), /ADMIN_REMOTE_WRITE_REQUIRES_SUPABASE/);
  assert.deepEqual(resolveRemoteAdminConfig({ ADMIN_DATA_SOURCE: "supabase", ADMIN_REMOTE_WRITE_ENABLED: "true" }), { dataSource: "supabase", remoteWriteEnabled: true });
  assert.throws(() => resolveRemoteAdminConfig({ ADMIN_DATA_SOURCE: "supabase" }), /ADMIN_DATA_SOURCE_REQUIRES_REMOTE_WRITE/);
});

test("Admin runtime config resolves operational mode and auto-publish independently", () => {
  assert.deepEqual(resolveAdminRuntimeConfig({
    ADMIN_DATA_SOURCE: "supabase",
    ADMIN_REMOTE_WRITE_ENABLED: "true",
    INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL: "false",
  }), {
    dataSource: "supabase",
    remoteWriteEnabled: true,
    autoPublishEnabled: false,
    sourceOfValue: {
      dataSource: "environment",
      remoteWriteEnabled: "environment",
      autoPublishEnabled: "environment",
    },
  });
});

test("Admin runtime config is read-only by safe default", () => {
  assert.deepEqual(resolveAdminRuntimeConfig({}), {
    dataSource: "supabase-readonly",
    remoteWriteEnabled: false,
    autoPublishEnabled: false,
    sourceOfValue: {
      dataSource: "default",
      remoteWriteEnabled: "default",
      autoPublishEnabled: "default",
    },
  });
  assert.throws(() => resolveAdminRuntimeConfig({ ADMIN_REMOTE_WRITE_ENABLED: "enabled" }), /ADMIN_REMOTE_WRITE_ENABLED_INVALID/);
  assert.throws(() => resolveAdminRuntimeConfig({ INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL: "enabled" }), /INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL_INVALID/);
});
