import path from "node:path";
import type { MediaFile, SongCatalogEntry, SongMatch } from "../shared/types.js";
import { normalizeForMatch, tokenSimilarity } from "./normalize.js";

type ScoredSong = { song: SongCatalogEntry; score: number; method: string };

function scoreSong(file: MediaFile, song: SongCatalogEntry): ScoredSong {
  const filename = normalizeForMatch(path.parse(file.sourceFilename).name);
  const title = normalizeForMatch(song.title);
  const category = normalizeForMatch(song.category);
  const relativeDirectory = normalizeForMatch(path.dirname(file.relativePath));

  if (filename === title) return { song, score: 1, method: "EXACT_TITLE" };
  if (filename === normalizeForMatch(`${song.category} ${song.title}`)) return { song, score: 0.98, method: "EXACT_CATEGORY_TITLE" };

  const similarity = tokenSimilarity(filename, title);
  const categoryBoost = category && relativeDirectory.includes(category) ? 0.08 : 0;
  const containsBoost = filename.includes(title) || title.includes(filename) ? 0.12 : 0;
  return { song, score: Math.min(0.96, similarity + categoryBoost + containsBoost), method: categoryBoost > 0 ? "TITLE_AND_CATEGORY" : "TITLE_SIMILARITY" };
}

export function matchMediaToSong(file: MediaFile, catalog: SongCatalogEntry[]): SongMatch {
  const scored = catalog.map((song) => scoreSong(file, song)).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  if (!best || best.score < 0.55) return { song: null, status: "UNMATCHED", method: null, confidence: null, score: best?.score ?? null };
  if (second && best.score - second.score < 0.05 && best.score < 0.95) {
    return { song: null, status: "AMBIGUOUS", method: "CLOSE_CANDIDATES", confidence: "LOW", score: best.score };
  }
  if (best.score >= 0.95) return { song: best.song, status: "MATCHED", method: best.method, confidence: "EXACT", score: best.score };
  if (best.score >= 0.78) return { song: best.song, status: "MATCHED", method: best.method, confidence: "HIGH", score: best.score };
  if (best.score >= 0.65) return { song: best.song, status: "REVIEW_REQUIRED", method: best.method, confidence: "MEDIUM", score: best.score };
  return { song: best.song, status: "REVIEW_REQUIRED", method: best.method, confidence: "LOW", score: best.score };
}
