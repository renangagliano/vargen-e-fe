import "server-only";

import { resolveAdminRuntimeConfig } from "@vargenfe/admin-shared/admin/remote-config";

export function getAdminRuntimeConfig() {
  return resolveAdminRuntimeConfig(process.env);
}
export function isOperationalAdminMode(config: ReturnType<typeof getAdminRuntimeConfig>): boolean {
  return config.dataSource === "supabase" && config.remoteWriteEnabled;
}
