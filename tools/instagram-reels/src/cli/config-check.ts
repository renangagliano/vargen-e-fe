import fs from "node:fs";
import path from "node:path";
import { loadProjectEnvironment } from "../config/index.js";

const REQUIRED_FOR_CONNECTIVITY = ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_ACCOUNT_ID", "META_APP_ID"] as const;
const SECRET_KEYS = new Set(["INSTAGRAM_ACCESS_TOKEN", "META_APP_SECRET"]);

function present(env: NodeJS.ProcessEnv, key: string): boolean {
  return Boolean(env[key]?.trim());
}

function corporateRuntimeDependency(env: NodeJS.ProcessEnv): boolean {
  const identifiers = ["ericsson", "ericsson.com", "azureoftest01", "3378a7c3-c9b3-408d-9c34-29106dc2b6d7", "92e84ceb-fbfd-47ab-be52-080c6b87953f", "oneDrive - Ericsson".toLowerCase()];
  const runtimeKeys = ["VARGEN_MEDIA_ROOT", "VARGEN_REELS_OUTPUT_ROOT", "VARGEN_PIPELINE_STATE_ROOT", "MICROSOFT_PERSONAL_AUTHORITY", "AZURE_STORAGE_ACCOUNT_NAME", "AZURE_STORAGE_CONTAINER_NAME", "AZURE_STORAGE_ENDPOINT_SUFFIX", "INSTAGRAM_TEMP_MEDIA_PROVIDER"];
  return runtimeKeys.some((key) => {
    const value = env[key];
    if (SECRET_KEYS.has(key) || !value) return false;
    const text = value.toLowerCase();
    return identifiers.some((identifier) => text.includes(identifier));
  });
}

function safeGraphHost(value: string | undefined): string {
  try { return new URL(value ?? "https://graph.instagram.com").hostname; } catch { return "INVALID"; }
}

export async function runInstagramConfigCheckCommand(command: string | undefined, repoRoot = process.cwd()): Promise<boolean> {
  if (command !== "instagram:config-check") return false;
  const env = loadProjectEnvironment(process.env, repoRoot);
  const localEnvPath = path.join(repoRoot, ".env.local");
  const missing = REQUIRED_FOR_CONNECTIVITY.filter((key) => !present(env, key));
  const corporate = corporateRuntimeDependency(env);
  const graphHost = safeGraphHost(env.META_GRAPH_API_BASE_URL);
  const graphApiVersion = env.META_GRAPH_API_VERSION?.trim() || "v22.0 (default)";
  const publishMode = env.INSTAGRAM_PUBLISH_MODE?.trim() || "dry-run (default)";
  console.log("Instagram Local Configuration");
  console.log("------------------------------");
  console.log(`INSTAGRAM_ACCESS_TOKEN: ${present(env, "INSTAGRAM_ACCESS_TOKEN") ? "PRESENT" : "MISSING"}`);
  console.log(`INSTAGRAM_ACCOUNT_ID: ${present(env, "INSTAGRAM_ACCOUNT_ID") ? "PRESENT" : "MISSING"}`);
  console.log(`META_APP_ID: ${present(env, "META_APP_ID") ? "PRESENT" : "MISSING"}`);
  console.log(`META_APP_SECRET: ${present(env, "META_APP_SECRET") ? "PRESENT (UNUSED)" : "NOT_REQUIRED"}`);
  console.log(`META_GRAPH_API_VERSION: ${graphApiVersion}`);
  console.log(`INSTAGRAM_PUBLISH_MODE: ${publishMode}`);
  console.log(`INSTAGRAM_REQUIRE_APPROVAL: ${env.INSTAGRAM_REQUIRE_APPROVAL?.trim() === "false" ? "DISABLED" : "ENABLED (default-safe)"}`);
  console.log(`INSTAGRAM_TIMEZONE: ${env.INSTAGRAM_TIMEZONE?.trim() ? "PRESENT" : "OPTIONAL_DEFAULT"}`);
  console.log(`Graph API host: ${graphHost}`);
  console.log(`Account ID: ${env.INSTAGRAM_ACCOUNT_ID?.trim() || "MISSING"}`);
  console.log(`.env.local: ${fs.existsSync(localEnvPath) ? "PRESENT" : "MISSING"}`);
  console.log(`Corporate runtime dependency: ${corporate ? "REJECTED" : "CLEAR"}`);
  console.log("Secrets exposed: NO");
  if (missing.length > 0) console.log(`Connectivity configuration: MISSING (${missing.join(", ")})`);
  else if (corporate) console.log("Connectivity configuration: BLOCKED_CORPORATE_DEPENDENCY");
  else console.log("Connectivity configuration: READY_FOR_READ_ONLY_VALIDATION");
  if (missing.length > 0 || corporate) process.exitCode = 1;
  return true;
}
