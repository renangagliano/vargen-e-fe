export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.(mp4|mov|m4v|webm)$/i, "")
    .replace(/\b(official|video|music|lyric|lyrics|visualizer|clipe?|4k|hd)\b/g, " ")
    .replace(/^[\s\-_]*\d{1,3}[\s\-_.)]+/g, "")
    .replace(/[_–—()[\]{}]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(value: string): Set<string> {
  return new Set(normalizeForMatch(value).split(" ").filter((token) => token.length > 1));
}

export function tokenSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}
