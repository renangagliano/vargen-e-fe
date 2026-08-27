import fs from "node:fs/promises";
import path from "node:path";
import type { MediaFile } from "../shared/types.js";
import { assertFileInsideRoot, isSupportedExtension, safeRelativePath } from "../security/paths.js";

export type DiscoveryResult = {
  files: MediaFile[];
  directoriesVisited: number;
  skippedSymlinks: number;
  errors: Array<{ path: string; code: string; message: string }>;
};

export async function discoverMedia(root: string): Promise<DiscoveryResult> {
  const files: MediaFile[] = [];
  const errors: DiscoveryResult["errors"] = [];
  let directoriesVisited = 0;
  let skippedSymlinks = 0;

  async function visit(directory: string): Promise<void> {
    directoriesVisited += 1;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      errors.push({ path: directory, code: "READ_DIRECTORY_FAILED", message: error instanceof Error ? error.message : String(error) });
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        skippedSymlinks += 1;
        errors.push({ path: absolutePath, code: "SYMLINK_SKIPPED", message: "Symlinks/junctions are not followed." });
        continue;
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !isSupportedExtension(path.extname(entry.name))) continue;

      try {
        await assertFileInsideRoot(root, absolutePath);
        const stats = await fs.stat(absolutePath);
        files.push({
          absolutePath,
          relativePath: safeRelativePath(root, absolutePath),
          sourceFilename: entry.name,
          extension: path.extname(entry.name).slice(1).toLowerCase() as MediaFile["extension"],
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        });
      } catch (error) {
        errors.push({ path: absolutePath, code: "PATH_VALIDATION_FAILED", message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  await visit(root);
  return { files, directoriesVisited, skippedSymlinks, errors };
}
