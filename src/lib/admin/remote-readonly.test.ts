import assert from "node:assert/strict";
import test from "node:test";
import { assertRemoteReadOnly } from "./remote-readonly.ts";

test("remote admin mutation guard permits only explicit read-only mode", () => {
  assert.doesNotThrow(() => assertRemoteReadOnly({ ADMIN_DATA_SOURCE: "supabase-readonly", ADMIN_REMOTE_WRITE_ENABLED: "false" }));
  assert.throws(() => assertRemoteReadOnly({ ADMIN_DATA_SOURCE: "sqlite", ADMIN_REMOTE_WRITE_ENABLED: "false" }), /REMOTE_WRITE_DISABLED/);
  assert.throws(() => assertRemoteReadOnly({ ADMIN_DATA_SOURCE: "supabase-readonly", ADMIN_REMOTE_WRITE_ENABLED: "true" }), /REMOTE_WRITE_DISABLED/);
});
