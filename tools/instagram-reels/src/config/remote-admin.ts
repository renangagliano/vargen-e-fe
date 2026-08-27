export type AdminDataSource = "sqlite" | "supabase-readonly" | "supabase";
type Environment = NodeJS.ProcessEnv | Record<string, string | undefined>;

export function resolveAdminDataSource(env: Environment = process.env): AdminDataSource {
  const value = env.ADMIN_DATA_SOURCE?.trim() || "sqlite";
  if (value === "sqlite" || value === "supabase-readonly" || value === "supabase") return value;
  throw new Error("ADMIN_DATA_SOURCE_INVALID");
}

export function resolveRemoteWriteEnabled(env: Environment = process.env): boolean {
  const raw = env.ADMIN_REMOTE_WRITE_ENABLED?.trim().toLowerCase();
  if (!raw) return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error("ADMIN_REMOTE_WRITE_ENABLED_INVALID");
}

export function resolveRemoteAdminConfig(env: Environment = process.env): { dataSource: AdminDataSource; remoteWriteEnabled: boolean } {
  const dataSource = resolveAdminDataSource(env);
  const remoteWriteEnabled = resolveRemoteWriteEnabled(env);
  if (dataSource === "supabase" && !remoteWriteEnabled) throw new Error("ADMIN_DATA_SOURCE_REQUIRES_REMOTE_WRITE");
  if (remoteWriteEnabled && dataSource !== "supabase") throw new Error("ADMIN_REMOTE_WRITE_REQUIRES_SUPABASE");
  return { dataSource, remoteWriteEnabled };
}
