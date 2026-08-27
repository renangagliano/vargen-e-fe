import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ToolDetection = {
  name: "ffmpeg" | "ffprobe";
  installed: boolean;
  executablePath: string | null;
  version: string | null;
  error: string | null;
};

async function resolveExecutable(command: string): Promise<string | null> {
  const resolver = os.platform() === "win32" ? "where.exe" : "which";
  try {
    const result = await execFileAsync(resolver, [command], { windowsHide: true });
    return String(result.stdout).split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

export async function detectTool(name: "ffmpeg" | "ffprobe", configuredPath?: string): Promise<ToolDetection> {
  const executablePath = configuredPath?.trim() || await resolveExecutable(name);
  if (!executablePath) return { name, installed: false, executablePath: null, version: null, error: "EXECUTABLE_NOT_FOUND" };

  try {
    const result = await execFileAsync(executablePath, ["-version"], { windowsHide: true, maxBuffer: 1024 * 1024 });
    const firstLine = String(result.stdout).split(/\r?\n/).find(Boolean) ?? "";
    return { name, installed: true, executablePath, version: firstLine || null, error: null };
  } catch (error) {
    return { name, installed: false, executablePath, version: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function detectMediaTools(env: NodeJS.ProcessEnv = process.env): Promise<{ ffmpeg: ToolDetection; ffprobe: ToolDetection }> {
  return {
    ffmpeg: await detectTool("ffmpeg", env.FFMPEG_BIN),
    ffprobe: await detectTool("ffprobe", env.FFPROBE_BIN),
  };
}
