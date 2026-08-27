import fs from "node:fs";
import path from "node:path";
import type { MediaConfig } from "../config/index.js";
import { exportPath, exportSqliteGovernance } from "./sqlite-export.js";
import { resolveAdminDataSource, resolveRemoteWriteEnabled } from "../config/remote-admin.js";

export type ImportOptions = { apply: boolean; inputPath?: string };

export function importSupabase(config: MediaConfig, options: ImportOptions): Record<string, unknown> {
  const dataSource = resolveAdminDataSource();
  const remoteWriteEnabled = resolveRemoteWriteEnabled();
  const source = options.inputPath ? path.resolve(options.inputPath) : exportPath(config);
  if (!fs.existsSync(source)) exportSqliteGovernance(config);
  const payload = JSON.parse(fs.readFileSync(source, "utf8")) as { manifest?: Record<string, unknown>; tables?: Record<string, unknown[]> };
  const counts = Object.fromEntries(Object.entries(payload.tables ?? {}).map(([table, rows]) => [table, rows.length]));
  if (!options.apply) return { mode: "dry-run", would_import: counts, remote_write_enabled: remoteWriteEnabled, apply_performed: false, secrets_exported: false, media_bytes_exported: false };
  if (!remoteWriteEnabled) throw new Error("ADMIN_REMOTE_WRITE_DISABLED");
  if (dataSource !== "supabase-readonly") throw new Error("ADMIN_REMOTE_DATA_SOURCE_REQUIRED");
  throw new Error("SUPABASE_IMPORT_NOT_CONNECTED");
}

export function runSupabaseImport(config: MediaConfig, args: string[]): void {
  const result = importSupabase(config, { apply: args.includes("--apply"), inputPath: args.find((arg) => arg.startsWith("--input="))?.slice("--input=".length) });
  console.log(JSON.stringify(result, null, 2));
}
