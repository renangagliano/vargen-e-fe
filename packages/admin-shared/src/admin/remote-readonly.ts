import { resolveRemoteAdminConfig } from "./remote-config.ts";

export function assertRemoteReadOnly(env: NodeJS.ProcessEnv | Record<string, string | undefined>): void {
  let config;
  try { config = resolveRemoteAdminConfig(env); } catch { throw new Error("REMOTE_WRITE_DISABLED"); }
  if (config.dataSource !== "supabase-readonly" || config.remoteWriteEnabled) throw new Error("REMOTE_WRITE_DISABLED");
}
