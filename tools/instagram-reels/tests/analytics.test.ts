import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { fixture } from "./review.test.js";
import { collectInstagramAnalytics, assertObservationWindowDue } from "../src/analytics/instagram-analytics.js";
import { openDatabase } from "../src/database/db.js";
import { MetaPilotApiError } from "../src/publishing/meta-pilot-api.js";

async function publishedFixture() {
  const item = await fixture();
  const db = openDatabase(item.config);
  const publishedAt = "2026-01-01T00:00:00.000Z";
  db.prepare("INSERT INTO pilot_snapshots (snapshot_id, reel_id, publication_key, snapshot_version, snapshot_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("snapshot-analytics-fixture", item.reelId, "publication-analytics-fixture", "test", "{}", "PUBLISHED", publishedAt, publishedAt);
  db.prepare("INSERT INTO pilot_publications (publication_key, snapshot_id, reel_id, status, attempt_count, instagram_media_id, published_at, created_at, updated_at) VALUES (?, ?, ?, 'PUBLISHED', 1, ?, ?, ?, ?)").run("publication-analytics-fixture", "snapshot-analytics-fixture", item.reelId, "media-analytics-fixture", publishedAt, publishedAt, publishedAt);
  db.close();
  return item;
}

test("analytics ingestion persists a read-only timestamped snapshot without fabricating missing values", async () => {
  const item = await publishedFixture();
  const calls: string[] = [];
  const result = await collectInstagramAnalytics({
    config: item.config,
    reelId: item.reelId,
    observationWindow: "initial",
    apiVersion: "v22.0",
    api: {
      async readPublication(mediaId) { assert.equal(mediaId, "media-analytics-fixture"); return { id: mediaId, media_product_type: "REELS" }; },
      async getMediaInsights(_mediaId, metric) {
        calls.push(metric);
        if (metric === "saved") throw new MetaPilotApiError("META_API_ERROR", "unsupported", 400);
        if (metric === "reach") return [];
        return [{ name: metric, values: [{ value: 7, end_time: "2026-01-01T01:00:00.000Z" }] }];
      },
    },
    now: () => new Date("2026-01-01T02:00:00.000Z"),
  });
  assert.equal(result.snapshot.status, "PARTIAL");
  assert.equal(result.snapshot.metrics.likes.value, 7);
  assert.equal(result.snapshot.metrics.reach.status, "NOT_AVAILABLE");
  assert.equal(result.snapshot.metrics.reach.value, undefined);
  assert.equal(result.snapshot.metrics.saves.status, "UNSUPPORTED");
  assert.equal(result.snapshot.metrics.followers.status, "NOT_AVAILABLE");
  assert.equal(calls.includes("total_interactions"), true);
  assert.ok(result.reportPath);
  await fs.access(result.reportPath!);
  const db = openDatabase(item.config);
  try {
    const row = db.prepare("SELECT observation_window, api_version, source_timestamp, metrics_json FROM instagram_analytics_snapshots WHERE reel_id = ?").get(item.reelId) as { observation_window: string; api_version: string; source_timestamp: string; metrics_json: string };
    assert.equal(row.observation_window, "initial");
    assert.equal(row.api_version, "v22.0");
    assert.equal(row.source_timestamp, "2026-01-01T01:00:00.000Z");
    assert.equal(JSON.parse(row.metrics_json).reach.value, undefined);
  } finally { db.close(); }
});

test("analytics observation windows remain explicit and are not collected early", () => {
  assert.doesNotThrow(() => assertObservationWindowDue("initial", "2026-01-01T00:00:00.000Z", Date.parse("2025-12-01T00:00:00.000Z")));
  assert.throws(() => assertObservationWindowDue("24h", "2026-01-01T00:00:00.000Z", Date.parse("2026-01-01T23:59:59.000Z")), /ANALYTICS_WINDOW_NOT_DUE/);
  assert.doesNotThrow(() => assertObservationWindowDue("24h", "2026-01-01T00:00:00.000Z", Date.parse("2026-01-02T00:00:00.000Z")));
});

test("Meta analytics adapter uses GET only and never sends publication writes", async () => {
  const methods: string[] = [];
  const api = new (await import("../src/publishing/meta-pilot-api.js")).MetaPilotApi({ accessToken: "test-token", accountId: "account-1", graphApiVersion: "v22.0", fetcher: async (input, init) => {
    methods.push(String(init?.method ?? "GET"));
    assert.match(String(input), /\/media-1\/insights\?metric=views$/);
    return new Response(JSON.stringify({ data: [{ name: "views", values: [{ value: 11 }] }] }), { status: 200 });
  } });
  const rows = await api.getMediaInsights("media-1", "views");
  assert.equal(rows[0]?.name, "views");
  assert.deepEqual(methods, ["GET"]);
});
