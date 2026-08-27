import { SupabaseGovernanceRepository } from "../../../src/lib/admin/governance-repository";
import { createSupabaseServerClient } from "../../../src/lib/supabase/server";

export async function getRemoteRepository() {
  return new SupabaseGovernanceRepository(await createSupabaseServerClient());
}
