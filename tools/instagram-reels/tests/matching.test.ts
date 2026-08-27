import assert from "node:assert/strict";
import test from "node:test";
import { matchMediaToSong } from "../src/matching/match.js";
import type { MediaFile, SongCatalogEntry } from "../src/shared/types.js";

const catalog: SongCatalogEntry[] = [
  { slug: "natal-a-estrela-e-o-rei", title: "A Estrela e o Rei", category: "Tempo do Natal", videoId: "abc" },
  { slug: "pascoa-a-minha-paz-vos-dou", title: "A Minha Paz Vos Dou", category: "Domingo da Páscoa", videoId: "def" },
];

function file(sourceFilename: string): MediaFile {
  return { absolutePath: sourceFilename, relativePath: `Tempo do Natal/${sourceFilename}`, sourceFilename, extension: "mp4", size: 10, mtimeMs: 1 };
}

test("matches accented Portuguese title exactly without changing source names", () => {
  const result = matchMediaToSong(file("Á Estrela e o Rei.mp4"), catalog);
  assert.equal(result.status, "MATCHED");
  assert.equal(result.confidence, "EXACT");
  assert.equal(result.song?.title, "A Estrela e o Rei");
});

test("does not silently accept an unknown title", () => {
  const result = matchMediaToSong(file("Canção que não existe.mp4"), catalog);
  assert.equal(result.status, "UNMATCHED");
  assert.equal(result.song, null);
});
