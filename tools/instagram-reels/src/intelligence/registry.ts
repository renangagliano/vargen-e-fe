import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, type MediaConfig } from "../config/index.js";
import { openDatabase } from "../database/db.js";
import { loadSongCatalog } from "../matching/catalog.js";
import type { BibleSourceType, SourceRegistryRecord } from "../shared/types.js";

const REGISTRY_VERSION = "phase7.2-source-registry-v1";
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".ts", ".tsx"]);
const KEYWORDS = /lyrics|letra|prompt|suno|song|music|musica|metadata|content|note|biblia|scripture/i;

type Row = Record<string, unknown>;

function hash(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function now(): string { return new Date().toISOString(); }
function stableId(value: string): string { return `source-${hash(value).slice(0, 32)}`; }
function normalize(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim(); }
function relativeLocation(repoRoot: string, value: string): string { return path.relative(repoRoot, value).split(path.sep).join("/"); }
function safeExcerpt(value: string): string { return value.replace(/\s+/g, " ").trim().slice(0, 280); }

const BOOKS = [
  "Gênesis", "Êxodo", "Levítico", "Números", "Deuteronômio", "Josué", "Juízes", "Rute", "1 Samuel", "2 Samuel", "1 Reis", "2 Reis", "1 Crônicas", "2 Crônicas", "Esdras", "Neemias", "Tobias", "Judite", "Ester", "Jó", "Salmo", "Salmos", "Provérbios", "Eclesiastes", "Cântico dos Cânticos", "Sabedoria", "Eclesiástico", "Isaías", "Jeremias", "Lamentações", "Baruc", "Ezequiel", "Daniel", "Oséias", "Joel", "Amós", "Abdias", "Jonas", "Miquéias", "Naum", "Habacuc", "Sofonias", "Ageu", "Zacarias", "Malaquias", "Mateus", "Marcos", "Lucas", "João", "Atos", "Romanos", "1 Coríntios", "2 Coríntios", "Gálatas", "Efésios", "Filipenses", "Colossenses", "1 Tessalonicenses", "2 Tessalonicenses", "1 Timóteo", "2 Timóteo", "Tito", "Filemom", "Hebreus", "Tiago", "1 Pedro", "2 Pedro", "1 João", "2 João", "3 João", "Judas", "Apocalipse",
];
const referencePattern = new RegExp(`(?:^|[^\\p{L}])(${BOOKS.sort((a, b) => b.length - a.length).map((book) => book.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")).join("|")})\\s+(\\d+)(?:\\s*[,.:]\\s*(\\d+(?:\\s*[-–—]\\s*\\d+)?(?:\\s*[.;]\\s*\\d+(?:\\s*[-–—]\\s*\\d+)?)?))?`, "giu");

export function extractExplicitReferences(text: string): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(referencePattern)) {
    const reference = `${match[1]} ${match[2]}${match[3] ? `,${match[3].replace(/\s+/g, "")}` : ""}`.replace(/\s+/g, " ").trim();
    if (!values.some((existing) => normalize(existing) === normalize(reference))) values.push(reference);
  }
  return values;
}

async function readIfExists(filePath: string): Promise<string | null> {
  try { return await fs.readFile(filePath, "utf8"); } catch { return null; }
}

async function walkApproved(root: string, output: string[] = []): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || ["node_modules", "out", "generated", ".git"].includes(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await walkApproved(full, output);
    else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && (KEYWORDS.test(entry.name) || root.includes(`${path.sep}docs${path.sep}`))) output.push(full);
  }
  return output;
}

function sourceTypeFor(filePath: string): BibleSourceType {
  const value = filePath.toLowerCase();
  if (value.includes("suno")) return "SUNO_PROMPT";
  if (value.includes("prompt")) return "SONG_CREATION_PROMPT";
  if (value.includes("lyric") || value.includes("letra")) return "SONG_LYRICS";
  if (value.includes(`${path.sep}docs${path.sep}`)) return "PROJECT_DOCUMENTATION";
  return "OTHER_LOCAL_SOURCE";
}

function sourceRecord(input: Omit<SourceRegistryRecord, "source_record_id" | "discovered_at">): SourceRegistryRecord {
  return { ...input, source_record_id: stableId(`${input.song_slug}:${input.source_type}:${input.source_location}:${input.content_hash}`), discovered_at: now() };
}

function upsert(db: ReturnType<typeof openDatabase>, record: SourceRegistryRecord): void {
  db.prepare(`INSERT INTO song_source_registry (source_record_id, song_slug, source_type, source_location, content_hash, source_title, source_version, is_authoritative, discovered_at, metadata_json_safe)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(song_slug, source_type, source_location, content_hash) DO UPDATE SET source_title=excluded.source_title, source_version=excluded.source_version, is_authoritative=excluded.is_authoritative, discovered_at=excluded.discovered_at, metadata_json_safe=excluded.metadata_json_safe`).run(
    record.source_record_id, record.song_slug, record.source_type, record.source_location, record.content_hash, record.source_title, record.source_version, record.is_authoritative ? 1 : 0, record.discovered_at, JSON.stringify(record.metadata_json_safe),
  );
}

function catalogRecord(repoRoot: string, song: { slug: string; title: string; category: string }, content: string): SourceRegistryRecord {
  return sourceRecord({ song_slug: song.slug, source_type: "CATALOG_METADATA", source_location: "src/data/songs.ts", content_hash: hash(content), source_title: song.title, source_version: REGISTRY_VERSION, is_authoritative: true, metadata_json_safe: { category: song.category, title: song.title, evidence_role: "catalog_identity_and_collection_only", explicit_references: extractExplicitReferences(content) } });
}

function seasonRecord(song: { slug: string; title: string; category: string }, content: string): SourceRegistryRecord {
  return sourceRecord({ song_slug: song.slug, source_type: "LITURGICAL_METADATA", source_location: "src/data/seasons.ts", content_hash: hash(content), source_title: song.category, source_version: REGISTRY_VERSION, is_authoritative: true, metadata_json_safe: { category: song.category, evidence_role: "season_and_liturgical_context_only", explicit_references: extractExplicitReferences(content) } });
}

export async function buildSourceRegistry(config: MediaConfig = loadConfig()): Promise<{ records: SourceRegistryRecord[]; songs: number; report: Record<string, unknown> }> {
  const catalog = await loadSongCatalog(config.repoRoot);
  const songsContent = await fs.readFile(path.join(config.repoRoot, "src", "data", "songs.ts"), "utf8");
  const seasonsContent = await fs.readFile(path.join(config.repoRoot, "src", "data", "seasons.ts"), "utf8");
  const db = openDatabase(config);
  const records: SourceRegistryRecord[] = [];
  const add = (record: SourceRegistryRecord) => { upsert(db, record); records.push(record); };
  try {
    const evidenceFiles = new Set<string>([path.join(config.repoRoot, "src", "data", "songs.ts"), path.join(config.repoRoot, "src", "data", "seasons.ts")]);
    for (const rootName of ["docs", "lyrics", "prompts", "songs", "music", "suno", "content", "metadata"]) {
      const root = path.join(config.repoRoot, rootName);
      for (const file of await walkApproved(root)) evidenceFiles.add(file);
    }
    const evidenceContents = new Map<string, string>();
    for (const file of evidenceFiles) {
      const content = await readIfExists(file);
      if (content !== null) evidenceContents.set(file, content);
    }

    for (const song of catalog) {
      add(catalogRecord(config.repoRoot, song, songsContent));
      add(seasonRecord(song, seasonsContent));

      const asset = db.prepare(`SELECT a.asset_id, a.checksum_sha256, a.duration_ms, a.width, a.height, a.frame_rate, a.video_codec, a.audio_codec, l.relative_path
        FROM media_assets a JOIN song_media_matches m ON m.asset_id = a.asset_id
        LEFT JOIN media_locations l ON l.asset_id = a.asset_id AND l.exists_now = 1
        WHERE m.song_slug = ? LIMIT 1`).get(song.slug) as Row | undefined;
      if (asset) add(sourceRecord({ song_slug: song.slug, source_type: "VIDEO_METADATA", source_location: String(asset.relative_path ?? "[VARGEN_MEDIA_ROOT]"), content_hash: String(asset.checksum_sha256 ?? ""), source_title: song.title, source_version: REGISTRY_VERSION, is_authoritative: false, metadata_json_safe: { asset_id: asset.asset_id, duration_ms: asset.duration_ms, width: asset.width, height: asset.height, frame_rate: asset.frame_rate, video_codec: asset.video_codec, audio_codec: asset.audio_codec, evidence_role: "technical_media_only" } }));

      const packages = db.prepare(`SELECT p.reel_id, p.editorial_version, p.package_json, d.output_relative_path
        FROM reel_editorial_packages p JOIN derived_reels d ON d.reel_id = p.reel_id
        JOIN song_media_matches m ON m.asset_id = d.source_asset_id WHERE m.song_slug = ?`).all(song.slug) as Row[];
      for (const pkg of packages) add(sourceRecord({ song_slug: song.slug, source_type: "GENERATED_EDITORIAL", source_location: String(pkg.output_relative_path ?? `derived_reels/${pkg.reel_id}`), content_hash: hash(String(pkg.package_json ?? "")), source_title: song.title, source_version: String(pkg.editorial_version ?? REGISTRY_VERSION), is_authoritative: false, metadata_json_safe: { reel_id: pkg.reel_id, evidence_role: "generated_editorial_not_scripture_authority" } }));

      for (const [file, content] of evidenceContents) {
        if (file.endsWith(`${path.sep}songs.ts`) || file.endsWith(`${path.sep}seasons.ts`)) continue;
        const haystack = normalize(`${file} ${content}`);
        const titleTokens = normalize(song.title).split(" ").filter((token) => token.length > 3);
        const titleMatch = titleTokens.length > 0 && titleTokens.every((token) => haystack.includes(token));
        if (!titleMatch) continue;
        const type = sourceTypeFor(file);
        const location = relativeLocation(config.repoRoot, file);
        add(sourceRecord({ song_slug: song.slug, source_type: type, source_location: location, content_hash: hash(content), source_title: song.title, source_version: REGISTRY_VERSION, is_authoritative: type !== "PROJECT_DOCUMENTATION" || /(?:refer[eê]ncia|bíblia|scripture|salmo|êxodo|evangelho)/iu.test(content), metadata_json_safe: { evidence_excerpt_safe: safeExcerpt(content), explicit_references: extractExplicitReferences(content), evidence_role: type === "SONG_LYRICS" || type === "SONG_CREATION_PROMPT" || type === "SUNO_PROMPT" ? "authoritative_creative_source" : "local_context_requires_review" } }));
      }
    }

    const verifiedSources = db.prepare(`SELECT b.*, m.song_slug FROM bible_reference_sources b JOIN derived_reels d ON d.reel_id = b.reel_id JOIN song_media_matches m ON m.asset_id = d.source_asset_id WHERE b.verification_status = 'VERIFIED'`).all() as Row[];
    for (const row of verifiedSources) {
      add(sourceRecord({ song_slug: String(row.song_slug), source_type: "HUMAN_PROVIDED_REFERENCE", source_location: String(row.source_location ?? "[HUMAN_REVIEW]"), content_hash: hash(`${row.reference}|${row.verified_by}|${row.verified_at}`), source_title: String(row.reference ?? ""), source_version: String(row.editorial_version ?? REGISTRY_VERSION), is_authoritative: true, metadata_json_safe: { reference: row.reference, verified_by: row.verified_by, verified_at: row.verified_at, evidence_role: "prior_human_verification" } }));
    }
    const persisted = db.prepare("SELECT * FROM song_source_registry ORDER BY song_slug, source_type, source_location").all() as Row[];
    const counts = Object.fromEntries([...new Set(persisted.map((row) => String(row.source_type)))].map((type) => [type, persisted.filter((row) => String(row.source_type) === type).length]));
    const songRows = catalog.map((song) => ({ song: song.title, song_slug: song.slug, sources: persisted.filter((row) => String(row.song_slug) === song.slug).map((row) => ({ source_record_id: row.source_record_id, source_type: row.source_type, source_location: row.source_location, authoritative: Boolean(row.is_authoritative), metadata: JSON.parse(String(row.metadata_json_safe ?? "{}")) })) }));
    return { records: songRows.flatMap((row) => row.sources as unknown as SourceRegistryRecord[]), songs: catalog.length, report: { generated_at: now(), registry_version: REGISTRY_VERSION, songs: catalog.length, source_records: persisted.length, source_type_counts: counts, song_records: songRows } };
  } finally { db.close(); }
}

export async function writeSourceRegistryReport(config: MediaConfig = loadConfig()): Promise<{ jsonPath: string; songs: number; sourceRecords: number }> {
  if (!config.reelsOutputRoot) throw new Error("REELS_OUTPUT_ROOT_NOT_CONFIGURED");
  const result = await buildSourceRegistry(config);
  const jsonPath = path.join(config.reelsOutputRoot, "biblical-source-registry.json");
  await fs.writeFile(jsonPath, `${JSON.stringify(result.report, null, 2)}\n`, "utf8");
  return { jsonPath, songs: result.songs, sourceRecords: Number(result.report.source_records) };
}

export { REGISTRY_VERSION };
