import fs from "node:fs/promises";
import path from "node:path";
import type { MediaConfig } from "../config/index.js";
import { assertDirectoryOutside } from "../security/paths.js";

export const REELS_SUBDIRECTORIES = [
  "Ano-Liturgico-C",
  "7-Dias-com-Deus",
  "12-Meses-com-Deus",
  "Devocionais",
  "Outros",
  "Published",
] as const;

export async function ensureReelsStructure(config: MediaConfig): Promise<string[]> {
  if (!config.mediaRoot) throw new Error("MEDIA_ROOT_NOT_CONFIGURED");
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED: set VARGEN_REELS_OUTPUT_ROOT to the OneDrive Reels sibling folder.");
  const sourceParent = path.dirname(path.resolve(config.mediaRoot));
  const outputParent = path.dirname(path.resolve(config.reelsOutputRoot));
  if (sourceParent.toLowerCase() !== outputParent.toLowerCase()) {
    throw new Error("REELS_ROOT_MUST_BE_SIBLING_OF_MEDIA_ROOT");
  }
  await assertDirectoryOutside(config.mediaRoot, config.reelsOutputRoot);
  const directories = [config.reelsOutputRoot, ...REELS_SUBDIRECTORIES.map((name) => path.join(config.reelsOutputRoot as string, name))];
  for (const directory of directories) await fs.mkdir(directory, { recursive: true });
  return directories;
}
