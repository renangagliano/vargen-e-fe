import { redirect } from "next/navigation";
import { getAuthenticatedAdminIdentity } from "@vargenfe/admin-shared/admin/server-auth";

export async function requireAdminPage() {
  const identity = await getAuthenticatedAdminIdentity();
  if (!identity) redirect("/login");
  return identity;
}
