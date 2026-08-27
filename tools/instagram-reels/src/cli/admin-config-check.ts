import fs from "node:fs";
import path from "node:path";
import { loadProjectEnvironment, projectEnvironmentLocalKeyCount, projectEnvironmentSource } from "../config/index.js";
import { resolveRemoteAdminConfig } from "../config/remote-admin.js";
import { resolveSupabaseConfiguration } from "../config/supabase.js";

const SUPABASE_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

function present(value: string | undefined): boolean { return Boolean(value?.trim()); }

export function runAdminConfigCheckCommand(command: string | undefined, repoRoot = process.cwd()): boolean {
  if (command !== "admin:config-check") return false;
  const env = loadProjectEnvironment(process.env, repoRoot);
  try {
    for (const key of SUPABASE_KEYS) {
      if (projectEnvironmentLocalKeyCount(key, repoRoot) > 1) throw new Error(`${key}_DUPLICATE`);
    }
    const supabase = resolveSupabaseConfiguration(env);
    const admin = resolveRemoteAdminConfig(env);
    console.log("Supabase Configuration");
    console.log("----------------------");
    console.log(`NEXT_PUBLIC_SUPABASE_URL: PRESENT`);
    console.log(`Public key: PRESENT`);
    console.log(`Key type: ${supabase.publicKeyType}`);
    console.log(`Source: ${projectEnvironmentSource(supabase.publicKeyVariable ?? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env, repoRoot)}`);
    console.log(`Server secret: ${present(supabase.serverSecret) ? "PRESENT" : "MISSING"}`);
    if (supabase.serverSecretType) console.log(`Key type: ${supabase.serverSecretType}`);
    console.log(`Source: ${supabase.serverSecretVariable ? projectEnvironmentSource(supabase.serverSecretVariable, process.env, repoRoot) : "default"}`);
    console.log(`Project reference: ${supabase.projectRef}`);
    console.log(`ADMIN_DATA_SOURCE: ${admin.dataSource}`);
    console.log(`ADMIN_REMOTE_WRITE_ENABLED: ${admin.remoteWriteEnabled}`);
    console.log(`Remote writes: ${admin.remoteWriteEnabled ? "ENABLED" : "DISABLED"}`);
    console.log(`.env.local: ${fs.existsSync(path.join(repoRoot, ".env.local")) ? "PRESENT" : "MISSING"}`);
    console.log("Secrets exposed: NO");
  } catch (error) {
    console.log(`Supabase configuration: BLOCKED (${error instanceof Error ? error.message : "INVALID_CONFIGURATION"})`);
    process.exitCode = 1;
  }
  return true;
}
