import { SupabaseGovernanceRepository } from "@vargenfe/admin-shared/admin/governance-repository";
import { createSupabaseServerClient } from "@vargenfe/admin-shared/supabase/server";

export async function getRemoteRepository() {
  return new SupabaseGovernanceRepository(await createSupabaseServerClient());
}
