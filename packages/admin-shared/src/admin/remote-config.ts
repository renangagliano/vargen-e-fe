export type AdminDataSource = "sqlite" | "supabase-readonly" | "supabase";

export type RemoteAdminConfig = {
  dataSource: AdminDataSource;
  remoteWriteEnabled: boolean;
};

function parseStrictBoolean(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name}_INVALID`);
}

export function resolveAdminDataSource(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): AdminDataSource {
  const value = env.ADMIN_DATA_SOURCE?.trim() || "sqlite";
  if (value === "sqlite" || value === "supabase-readonly" || value === "supabase") return value;
  throw new Error("ADMIN_DATA_SOURCE_INVALID");
}

export function resolveRemoteAdminConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): RemoteAdminConfig {
  const dataSource = resolveAdminDataSource(env);
  const remoteWriteEnabled = parseStrictBoolean("ADMIN_REMOTE_WRITE_ENABLED", env.ADMIN_REMOTE_WRITE_ENABLED, false);
  if (dataSource === "supabase" && !remoteWriteEnabled) throw new Error("ADMIN_DATA_SOURCE_REQUIRES_REMOTE_WRITE");
  if (remoteWriteEnabled && dataSource !== "supabase") throw new Error("ADMIN_REMOTE_WRITE_REQUIRES_SUPABASE");
  return { dataSource, remoteWriteEnabled };
}
