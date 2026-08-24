import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MediaConfig } from "../config/index.js";
import { databasePath, loadConfig } from "../config/index.js";
import { detectMediaTools } from "../ffmpeg/detection.js";
import { assertDirectoryOutside } from "../security/paths.js";
import { ensureReelsStructure } from "../media/reels-structure.js";

export type DoctorCheck = { name: string; status: "PASS" | "WARN" | "FAIL"; detail: string };

async function readableDirectory(directory: string, create = false): Promise<{ ok: boolean; detail: string }> {
  try {
    if (create) await fs.mkdir(directory, { recursive: true });
    const stats = await fs.stat(directory);
    if (!stats.isDirectory()) return { ok: false, detail: "not a directory" };
    await fs.access(directory);
    if (create) {
      const probe = path.join(directory, `.vargen-write-check-${process.pid}-${Date.now()}`);
      await fs.writeFile(probe, "ok", { flag: "wx" });
      await fs.unlink(probe);
    }
    return { ok: true, detail: directory };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export async function runDoctor(config = loadConfig()): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [
    { name: "Node runtime", status: process.versions.node ? "PASS" : "FAIL", detail: process.versions.node },
    { name: "Operating system", status: "PASS", detail: `${process.platform} ${process.arch}` },
  ];

  if (!config.mediaRootConfigured || !config.mediaRoot) {
    checks.push({ name: "Media root configured", status: "FAIL", detail: "VARGEN_MEDIA_ROOT is not configured." });
  } else {
    const media = await readableDirectory(config.mediaRoot);
    checks.push({ name: "Media root", status: media.ok ? "PASS" : "FAIL", detail: media.ok ? config.mediaRoot : media.detail });
    checks.push({ name: "Media root readable", status: media.ok ? "PASS" : "FAIL", detail: media.ok ? "read-only access check" : media.detail });
  }

  let output = { ok: false, detail: "VARGEN_REELS_OUTPUT_ROOT is not configured." };
  if (config.reelsOutputRoot) {
    try {
      if (!config.mediaRoot) throw new Error("media root must be configured before creating Reels output");
      const sourceStats = await fs.stat(config.mediaRoot);
      if (!sourceStats.isDirectory()) throw new Error("media root is not a directory");
      if (path.dirname(path.resolve(config.mediaRoot)).toLowerCase() !== path.dirname(path.resolve(config.reelsOutputRoot)).toLowerCase()) {
        throw new Error("REELS_ROOT_MUST_BE_SIBLING_OF_MEDIA_ROOT");
      }
      await assertDirectoryOutside(config.mediaRoot, config.reelsOutputRoot);
      output = await readableDirectory(config.reelsOutputRoot, true);
    } catch (error) {
      output = { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
  checks.push({ name: "Reels output root", status: output.ok ? "PASS" : "FAIL", detail: output.ok ? config.reelsOutputRoot ?? "" : output.detail });
  const state = await readableDirectory(config.pipelineStateRoot, true);
  checks.push({ name: "State root", status: state.ok ? "PASS" : "FAIL", detail: state.ok ? config.pipelineStateRoot : state.detail });
  if (!config.reelsOutputRootConfigured) checks.push({ name: "Reels root configuration", status: "FAIL", detail: "Set VARGEN_REELS_OUTPUT_ROOT to the locally synchronized OneDrive Reels sibling folder." });
  if (!config.pipelineStateRootConfigured) checks.push({ name: "State root configuration", status: "WARN", detail: "Using a local temporary default outside OneDrive." });

  try {
    const database = new DatabaseSync(databasePath(config));
    database.close();
    checks.push({ name: "SQLite", status: "PASS", detail: "node:sqlite available" });
  } catch (error) {
    checks.push({ name: "SQLite", status: "FAIL", detail: error instanceof Error ? error.message : String(error) });
  }

  if (config.mediaRoot && config.mediaRootConfigured && state.ok) {
    for (const [name, directory] of [["Reels/source separation", config.reelsOutputRoot], ["State/source separation", config.pipelineStateRoot]] as const) {
      if (!directory) {
        checks.push({ name, status: "FAIL", detail: "output root is not configured" });
        continue;
      }
      try {
        await assertDirectoryOutside(config.mediaRoot, directory);
        checks.push({ name, status: "PASS", detail: "separate from VARGEN_MEDIA_ROOT" });
      } catch (error) {
        checks.push({ name, status: "FAIL", detail: error instanceof Error ? error.message : String(error) });
      }
    }
  } else {
    checks.push({ name: "Source/output/state separation", status: "WARN", detail: "Cannot fully validate until VARGEN_MEDIA_ROOT is configured." });
  }

  if (config.mediaRoot && config.reelsOutputRoot && output.ok) {
    try {
      const directories = await ensureReelsStructure(config);
      checks.push({ name: "Reels folder structure", status: "PASS", detail: `${directories.length} directories prepared` });
    } catch (error) {
      checks.push({ name: "Reels folder structure", status: "FAIL", detail: error instanceof Error ? error.message : String(error) });
    }
  } else {
    checks.push({ name: "Reels folder structure", status: "WARN", detail: "Waiting for configured sibling output root and media root." });
  }

  const tools = await detectMediaTools({ ...process.env, FFMPEG_BIN: config.ffmpegBin ?? process.env.FFMPEG_BIN, FFPROBE_BIN: config.ffprobeBin ?? process.env.FFPROBE_BIN });
  checks.push({ name: "FFmpeg", status: tools.ffmpeg.installed ? "PASS" : "FAIL", detail: tools.ffmpeg.version ?? tools.ffmpeg.error ?? "not found" });
  checks.push({ name: "FFprobe", status: tools.ffprobe.installed ? "PASS" : "FAIL", detail: tools.ffprobe.version ?? tools.ffprobe.error ?? "not found" });

  const gitignore = await fs.readFile(path.join(config.repoRoot, ".gitignore"), "utf8").catch(() => "");
  const protectedPatterns = ["/generated/reels/", "*.sqlite", "*.db"];
  const protectedCount = protectedPatterns.filter((pattern) => gitignore.includes(pattern)).length;
  checks.push({ name: "Git media protection", status: protectedCount === protectedPatterns.length ? "PASS" : "WARN", detail: `${protectedCount}/${protectedPatterns.length} runtime patterns present` });
  if (inside(config.repoRoot, config.pipelineStateRoot)) checks.push({ name: "State outside repository", status: "WARN", detail: "State root is inside the repository; prefer VARGEN_PIPELINE_STATE_ROOT outside Git." });
  else checks.push({ name: "State outside repository", status: "PASS", detail: "state path is outside repository" });

  return checks;
}

export function printDoctor(checks: DoctorCheck[]): void {
  for (const check of checks) console.log(`${check.name.padEnd(34, ".")} ${check.status.padEnd(4)} ${check.detail}`);
}
