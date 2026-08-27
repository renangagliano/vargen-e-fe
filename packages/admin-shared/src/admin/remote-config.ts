export type AdminDataSource = "sqlite" | "supabase-readonly" | "supabase";

export type RemoteAdminConfig = {
  dataSource: AdminDataSource;
  remoteWriteEnabled: boolean;
};

export type AdminRuntimeConfig = RemoteAdminConfig & {
  autoPublishEnabled: boolean;
  sourceOfValue: {
    dataSource: "environment" | "default";
    remoteWriteEnabled: "environment" | "default";
    autoPublishEnabled: "environment" | "default";
  };
};

function parseStrictBoolean(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name}_INVALID`);
}

export function resolveAdminDataSource(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): AdminDataSource {
  const value = env.ADMIN_DATA_SOURCE?.trim() || "supabase-readonly";
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

/**
 * The only server-side resolver for the Admin operational mode. Keep this
 * module out of Client Components: the values are private runtime controls,
 * not public browser configuration.
 */
export function resolveAdminRuntimeConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): AdminRuntimeConfig {
  const config = resolveRemoteAdminConfig(env);
  const autoPublishRaw = env.INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL;
  const autoPublishEnabled = parseStrictBoolean("INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL", autoPublishRaw, false);
  return {
    ...config,
    autoPublishEnabled,
    sourceOfValue: {
      dataSource: env.ADMIN_DATA_SOURCE?.trim() ? "environment" : "default",
      remoteWriteEnabled: env.ADMIN_REMOTE_WRITE_ENABLED?.trim() ? "environment" : "default",
      autoPublishEnabled: autoPublishRaw?.trim() ? "environment" : "default",
    },
  };
}
