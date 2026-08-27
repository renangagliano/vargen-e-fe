export type AdminDataSource = "sqlite" | "supabase-readonly";

export function resolveAdminDataSource(env: NodeJS.ProcessEnv = process.env): AdminDataSource {
  const value = env.ADMIN_DATA_SOURCE?.trim() || "sqlite";
  if (value === "sqlite" || value === "supabase-readonly") return value;
  throw new Error("ADMIN_DATA_SOURCE_INVALID");
}

export function resolveRemoteWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.ADMIN_REMOTE_WRITE_ENABLED?.trim().toLowerCase();
  if (!raw) return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error("ADMIN_REMOTE_WRITE_ENABLED_INVALID");
}
