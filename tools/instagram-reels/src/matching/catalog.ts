import fs from "node:fs/promises";
import path from "node:path";
import type { SongCatalogEntry } from "../shared/types.js";

function decodeSourceString(value: string): string {
  return JSON.parse(`"${value.replace(/\\/g, "\\\\").replace(/\\\\\\"/g, '\\\"')}"`) as string;
}

function slugify(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Reads the authoritative TrackSeed tuples from src/data/songs.ts. This is a
 * mapping layer, not a second song database: the source file remains the
 * editorial authority and is read on every catalog scan.
 */
export async function loadSongCatalog(repoRoot: string): Promise<SongCatalogEntry[]> {
  const sourcePath = path.join(repoRoot, "src", "data", "songs.ts");
  const source = await fs.readFile(sourcePath, "utf8");
  const entries: SongCatalogEntry[] = [];
  const tuplePattern = /^\s*\["((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"(?:,\s*"((?:[^"\\]|\\.)*)")?\s*\],?\s*$/;

  for (const line of source.split(/\r?\n/)) {
    const match = tuplePattern.exec(line);
    if (!match) continue;
    const category = decodeSourceString(match[1]);
    const title = decodeSourceString(match[2]);
    const videoId = match[3] ? decodeSourceString(match[3]) : null;
    entries.push({ slug: slugify(`${category}-${title}`), title, category, videoId });
  }

  if (entries.length === 0) throw new Error("SONG_CATALOG_EMPTY_OR_UNREADABLE");
  return entries;
}
