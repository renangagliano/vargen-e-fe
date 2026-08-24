import fs from "node:fs/promises";
import path from "node:path";

export function isSupportedExtension(value: string): value is ".mp4" | ".mov" | ".m4v" | ".webm" {
  return [".mp4", ".mov", ".m4v", ".webm"].includes(value.toLowerCase() as ".mp4" | ".mov" | ".m4v" | ".webm");
}

function relativeIsInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function canonicalPath(value: string): Promise<string> {
  return fs.realpath(value);
}

export async function assertPathInside(root: string, candidate: string, allowMissing = false): Promise<string> {
  const rootCanonical = await canonicalPath(root);
  const candidateResolved = path.resolve(candidate);
  if (!relativeIsInside(rootCanonical, candidateResolved)) {
    throw new Error(`PATH_OUTSIDE_MEDIA_ROOT: ${candidate}`);
  }
  let candidateCanonical: string;

  try {
    candidateCanonical = await canonicalPath(candidateResolved);
  } catch (error) {
    if (!allowMissing) throw error;
    candidateCanonical = candidateResolved;
  }

  if (!relativeIsInside(rootCanonical, candidateCanonical)) {
    throw new Error(`PATH_OUTSIDE_MEDIA_ROOT: ${candidate}`);
  }

  return candidateCanonical;
}

export async function assertDirectoryOutside(sourceRoot: string, candidate: string): Promise<void> {
  const sourceCanonical = await canonicalPath(sourceRoot);
  const candidateResolved = path.resolve(candidate);
  let candidateCanonical = candidateResolved;
  try {
    candidateCanonical = await canonicalPath(candidateResolved);
  } catch {
    // The output/state directory may not exist yet; its resolved path is checked below.
  }

  if (relativeIsInside(sourceCanonical, candidateCanonical) || relativeIsInside(candidateCanonical, sourceCanonical)) {
    throw new Error(`DIRECTORY_SEPARATION_REQUIRED: ${candidate}`);
  }
}

export async function assertFileInsideRoot(root: string, filePath: string): Promise<void> {
  const stats = await fs.lstat(filePath);
  if (stats.isSymbolicLink()) throw new Error(`SYMLINK_NOT_ALLOWED: ${filePath}`);
  await assertPathInside(root, filePath);
}

export function safeRelativePath(root: string, absolutePath: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(absolutePath));
  return relative.split(path.sep).join("/");
}
