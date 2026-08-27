import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseGovernanceMutationRepository } from "../../../packages/admin-shared/src/admin/governance-repository.ts";

test("Supabase governance mutations use the server RPC and preserve actor/version evidence", async () => {
  let call: { name: string; args: Record<string, unknown> } | undefined;
  const client = { rpc: async (name: string, args: Record<string, unknown>) => { call = { name, args }; return { data: { action: "save_editorial", reel_id: "reel-1", editorial_version: 3, state: {} }, error: null }; } };
  const repository = new SupabaseGovernanceMutationRepository(client as never);
  const result = await repository.execute({ action: "save_editorial", reel_id: "reel-1", expected_current_version: 2, request_id: "request:123", fields: { primary_pillar: "Fé" } }, { userId: "admin-id", email: null, role: "ADMIN" });
  assert.equal(result.editorial_version, 3);
  assert.equal(call?.name, "admin_governance_mutation");
  assert.equal(call?.args.p_actor_id, "admin-id");
  assert.equal(call?.args.p_expected_current_version, 2);
  assert.equal((call?.args.p_payload as Record<string, unknown>).primary_pillar, "Fé");
});

test("remote mutation errors expose only safe domain codes", async () => {
  const repository = new SupabaseGovernanceMutationRepository({ rpc: async () => ({ data: null, error: { message: "EDITORIAL_VERSION_CONFLICT: stale editor" } }) } as never);
  await assert.rejects(() => repository.execute({ action: "approve_editorial", reel_id: "reel-1", expected_current_version: 1, request_id: "request:123" }, { userId: "admin-id", email: null, role: "ADMIN" }), /EDITORIAL_VERSION_CONFLICT/);
});
