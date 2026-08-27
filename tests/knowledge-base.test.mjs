import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const knowledgeBasePath = path.join(repositoryRoot, "src", "data", "knowledge-base", "vargen-fe-knowledge-base-master.json");
const songsSourcePath = path.join(repositoryRoot, "src", "data", "songs.ts");

function slugify(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function readSongSlugs(source) {
  const tuplePattern = /^\s*\["((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"(?:,\s*"((?:[^"\\]|\\.)*)")?\s*\],?\s*$/;
  return [...source.split(/\r?\n/)].flatMap((line) => {
    const match = tuplePattern.exec(line);
    if (!match) return [];
    const category = JSON.parse(`"${match[1].replaceAll("\\", "\\\\")}"`);
    const title = JSON.parse(`"${match[2].replaceAll("\\", "\\\\")}"`);
    return [slugify(`${category}-${title}`)];
  });
}

async function loadFixtures() {
  const [knowledgeBaseText, songsSource] = await Promise.all([
    fs.readFile(knowledgeBasePath, "utf8"),
    fs.readFile(songsSourcePath, "utf8"),
  ]);
  return { catalog: JSON.parse(knowledgeBaseText), songSlugs: readSongSlugs(songsSource) };
}

test("the master Knowledge Base loads with the expected 79 records", async () => {
  const { catalog } = await loadFixtures();
  assert.equal(catalog.record_count, 79);
  assert.equal(catalog.songs.length, 79);
  assert.equal(catalog.schema_version, "1.0");
});

test("song IDs and slugs are unique and map one-to-one to songs.ts", async () => {
  const { catalog, songSlugs } = await loadFixtures();
  const songIds = catalog.songs.map((song) => song.song_id);
  const knowledgeSlugs = catalog.songs.map((song) => song.slug);
  assert.equal(new Set(songIds).size, songIds.length);
  assert.equal(new Set(knowledgeSlugs).size, knowledgeSlugs.length);
  assert.equal(songSlugs.length, 79);
  assert.deepEqual([...knowledgeSlugs].sort(), [...songSlugs].sort());
});

test("known and unknown slug resolution behave safely", async () => {
  const { catalog } = await loadFixtures();
  const bySlug = new Map(catalog.songs.map((song) => [song.slug, song]));
  assert.equal(bySlug.get("12-meses-com-deus-quando-as-aguas-se-abriram-marco")?.title, "Quando as Águas se Abriram — Março");
  assert.equal(bySlug.get("unknown-song-slug"), undefined);
});

test("optional fields remain representable as empty values and governance stays available", async () => {
  const { catalog } = await loadFixtures();
  const entry = catalog.songs.find((song) => song.historical_context === "");
  assert.ok(entry);
  assert.equal(entry.historical_context, "");
  assert.ok(Array.isArray(entry.secondary_bible_references));
  assert.ok(Array.isArray(entry.biblical_characters));
  assert.ok(entry.evidence_level);
  assert.ok(entry.confidence);
  assert.ok(entry.verification_status);
  assert.ok(entry.provenance);
  const withoutVideoEvidence = catalog.songs.find((song) => song.provenance.source_asset_video_id === null);
  assert.ok(withoutVideoEvidence);
  assert.equal(withoutVideoEvidence.provenance.source_asset_video_id, null);
});
