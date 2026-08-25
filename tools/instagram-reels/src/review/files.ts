import fs from "node:fs/promises";
import path from "node:path";
import type { MediaConfig } from "../config/index.js";
import { assertFileInsideRoot, assertPathInside } from "../security/paths.js";

const SERVED_EXTENSIONS = new Set([".mp4", ".jpg", ".jpeg", ".png", ".json", ".srt"]);

function relativeValue(root: string, value: string): string {
  const rootResolved = path.resolve(root);
  const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(rootResolved, value);
  const relative = path.relative(rootResolved, resolved);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) throw new Error("REVIEW_FILE_OUTSIDE_OUTPUT_ROOT");
  return relative;
}

export async function resolveReviewFile(config: MediaConfig, value: string, allowMissing = false): Promise<{ absolutePath: string; relativePath: string }> {
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  if (!value || value.includes("\0")) throw new Error("REVIEW_FILE_PATH_INVALID");
  const relativePath = relativeValue(config.reelsOutputRoot, value);
  if (!SERVED_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) throw new Error("REVIEW_FILE_EXTENSION_NOT_ALLOWED");
  const absolutePath = path.resolve(config.reelsOutputRoot, relativePath);
  await assertPathInside(config.reelsOutputRoot, absolutePath, allowMissing);
  if (!allowMissing) await assertFileInsideRoot(config.reelsOutputRoot, absolutePath);
  return { absolutePath, relativePath: relativePath.split(path.sep).join("/") };
}

export async function readReviewFile(config: MediaConfig, value: string): Promise<{ data: Buffer; absolutePath: string; relativePath: string }> {
  const resolved = await resolveReviewFile(config, value);
  return { ...resolved, data: await fs.readFile(resolved.absolutePath) };
}
