import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MediaConfig } from "../config/index.js";
import { insertInstagramAnalyticsSnapshot, instagramAnalyticsSnapshots, openDatabase, publishedPilotPublicationByReel, type InstagramAnalyticsSnapshotRecord } from "../database/db.js";
import { MetaPilotApiError, type MetaMediaInsight } from "../publishing/meta-pilot-api.js";

export const OBSERVATION_WINDOWS = ["initial", "1h", "24h", "72h", "7d"] as const;
export type ObservationWindow = typeof OBSERVATION_WINDOWS[number];
export type AnalyticsMetricStatus = "AVAILABLE" | "UNSUPPORTED" | "NOT_AVAILABLE";
export type AnalyticsSnapshotStatus = "READY" | "PARTIAL" | "NOT_AVAILABLE";

type MetricDefinition = { metric: string; apiMetric: string };
export type AnalyticsMetric = {
  status: AnalyticsMetricStatus;
  api_metric: string | null;
  value?: number;
  source_timestamp?: string;
  reason?: string;
};

export type InstagramAnalyticsSnapshot = {
  analytics_snapshot_id: string;
  reel_id: string;
  publication_key: string;
  instagram_media_id: string;
  observation_window: ObservationWindow;
  captured_at: string;
  source_timestamp: string | null;
  api_version: string;
  status: AnalyticsSnapshotStatus;
  metrics: Record<string, AnalyticsMetric>;
};

export type InstagramAnalyticsReport = {
  generated_at: string;
  reel_id: string;
  publication_key: string;
  instagram_media_id: string;
  api_version: string;
  source: "Instagram Graph API media insights";
  write_operations: "NONE";
  snapshots: InstagramAnalyticsSnapshot[];
};

const METRICS: MetricDefinition[] = [
  { metric: "views", apiMetric: "views" },
  { metric: "plays", apiMetric: "plays" },
  { metric: "reach", apiMetric: "reach" },
  { metric: "likes", apiMetric: "likes" },
  { metric: "comments", apiMetric: "comments" },
  { metric: "shares", apiMetric: "shares" },
  { metric: "saves", apiMetric: "saved" },
  { metric: "interactions", apiMetric: "total_interactions" },
  { metric: "total_watch_time", apiMetric: "ig_reels_video_view_total_time" },
  { metric: "average_watch_time", apiMetric: "ig_reels_avg_watch_time" },
];

const UNAVAILABLE_BREAKDOWN_METRICS = ["followers", "non_followers"] as const;

type AnalyticsApi = Pick<import("../publishing/meta-pilot-api.js").MetaPilotApi, "readPublication" | "getMediaInsights">;

function metricFromResponse(rows: MetaMediaInsight[], definition: MetricDefinition): AnalyticsMetric {
  const row = rows.find((candidate) => candidate.name === definition.apiMetric);
  if (!row) return { status: "NOT_AVAILABLE", api_metric: definition.apiMetric, reason: "EMPTY_OR_UNREPORTED_RESPONSE" };
  const totalValue = row.total_value?.value;
  const values = Array.isArray(row.values) ? row.values : [];
  const latest = values.length > 0 ? values[values.length - 1] : undefined;
  const rawValue = typeof totalValue === "number" ? totalValue : latest?.value;
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) return { status: "NOT_AVAILABLE", api_metric: definition.apiMetric, reason: "EMPTY_OR_UNREPORTED_RESPONSE" };
  return {
    status: "AVAILABLE",
    api_metric: definition.apiMetric,
    value: rawValue,
    ...(typeof latest?.end_time === "string" ? { source_timestamp: latest.end_time } : {}),
  };
}

function errorMetric(error: unknown, apiMetric: string): AnalyticsMetric {
  if (error instanceof MetaPilotApiError && (error.httpStatus === 400 || error.httpStatus === 404)) {
    return { status: "UNSUPPORTED", api_metric: apiMetric, reason: "METRIC_REJECTED_BY_API" };
  }
  return { status: "NOT_AVAILABLE", api_metric: apiMetric, reason: "API_RESPONSE_UNAVAILABLE" };
}

function windowOffset(window: ObservationWindow): number {
  if (window === "initial") return 0;
  if (window === "1h") return 60 * 60 * 1000;
  if (window === "24h") return 24 * 60 * 60 * 1000;
  if (window === "72h") return 72 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

export function assertObservationWindowDue(window: ObservationWindow, publishedAt: string, now = Date.now()): void {
  if (window === "initial") return;
  const publishedTime = Date.parse(publishedAt);
  if (Number.isNaN(publishedTime)) throw new Error("PUBLISHED_TIMESTAMP_INVALID");
  if (now < publishedTime + windowOffset(window)) throw new Error("ANALYTICS_WINDOW_NOT_DUE");
}

function snapshotStatus(metrics: Record<string, AnalyticsMetric>): AnalyticsSnapshotStatus {
  const statuses = Object.values(metrics).map((metric) => metric.status);
  if (statuses.some((status) => status === "AVAILABLE")) return statuses.every((status) => status === "AVAILABLE" || status === "NOT_AVAILABLE") ? "READY" : "PARTIAL";
  return "NOT_AVAILABLE";
}

function sourceTimestamp(metrics: Record<string, AnalyticsMetric>): string | null {
  const timestamps = Object.values(metrics).map((metric) => metric.source_timestamp).filter((value): value is string => Boolean(value));
  return timestamps.sort().at(-1) ?? null;
}

function fromRecord(record: InstagramAnalyticsSnapshotRecord): InstagramAnalyticsSnapshot {
  return {
    analytics_snapshot_id: record.analytics_snapshot_id,
    reel_id: record.reel_id,
    publication_key: record.publication_key,
    instagram_media_id: record.instagram_media_id,
    observation_window: record.observation_window as ObservationWindow,
    captured_at: record.captured_at,
    source_timestamp: record.source_timestamp,
    api_version: record.api_version,
    status: record.status as AnalyticsSnapshotStatus,
    metrics: JSON.parse(record.metrics_json) as Record<string, AnalyticsMetric>,
  };
}

export async function writeInstagramAnalyticsReport(config: MediaConfig, reelId: string, publicationKey: string, mediaId: string, apiVersion: string): Promise<string | null> {
  const db = openDatabase(config);
  let snapshots: InstagramAnalyticsSnapshot[];
  try { snapshots = instagramAnalyticsSnapshots(db, reelId).map(fromRecord); } finally { db.close(); }
  if (!config.reelsOutputRoot) return null;
  const report: InstagramAnalyticsReport = { generated_at: new Date().toISOString(), reel_id: reelId, publication_key: publicationKey, instagram_media_id: mediaId, api_version: apiVersion, source: "Instagram Graph API media insights", write_operations: "NONE", snapshots };
  const directory = path.join(config.reelsOutputRoot, "analytics");
  await fs.mkdir(directory, { recursive: true });
  const jsonPath = path.join(directory, `${reelId}-baseline.json`);
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const lines = [
    `# Instagram Analytics Baseline: ${reelId}`,
    "",
    `- Instagram media ID: ${mediaId}`,
    `- API version: ${apiVersion}`,
    "- Source: Instagram Graph API media insights",
    "- Write operations: NONE",
    "",
    ...snapshots.flatMap((snapshot) => [
      `## ${snapshot.observation_window} — ${snapshot.captured_at}`,
      `Status: ${snapshot.status}`,
      "",
      ...Object.entries(snapshot.metrics).map(([metric, value]) => `- ${metric}: ${value.status}${value.value === undefined ? "" : ` (${value.value})`}`),
      "",
    ]),
  ];
  await fs.writeFile(path.join(directory, `${reelId}-baseline.md`), `${lines.join("\n")}\n`, "utf8");
  return jsonPath;
}

export async function collectInstagramAnalytics(input: {
  config: MediaConfig;
  reelId: string;
  observationWindow: ObservationWindow;
  apiVersion: string;
  api: AnalyticsApi;
  now?: () => Date;
}): Promise<{ snapshot: InstagramAnalyticsSnapshot; reportPath: string | null }> {
  const db = openDatabase(input.config);
  let publication: Record<string, unknown> | undefined;
  try { publication = publishedPilotPublicationByReel(db, input.reelId); } finally { db.close(); }
  if (!publication?.instagram_media_id || !publication.publication_key || !publication.published_at) throw new Error("PUBLISHED_MEDIA_NOT_FOUND");
  assertObservationWindowDue(input.observationWindow, String(publication.published_at), (input.now ?? (() => new Date()))().getTime());
  const mediaId = String(publication.instagram_media_id);
  const readback = await input.api.readPublication(mediaId);
  if (readback.id !== mediaId || (readback.media_product_type && readback.media_product_type.toUpperCase() !== "REELS")) throw new Error("PUBLISHED_REEL_READBACK_FAILED");

  const metrics: Record<string, AnalyticsMetric> = {};
  for (const definition of METRICS) {
    try { metrics[definition.metric] = metricFromResponse(await input.api.getMediaInsights(mediaId, definition.apiMetric), definition); }
    catch (error) { metrics[definition.metric] = errorMetric(error, definition.apiMetric); }
  }
  for (const metric of UNAVAILABLE_BREAKDOWN_METRICS) metrics[metric] = { status: "NOT_AVAILABLE", api_metric: null, reason: "MEDIA_FOLLOWER_BREAKDOWN_NOT_RETURNED" };
  const capturedAt = (input.now ?? (() => new Date()))().toISOString();
  const snapshot: InstagramAnalyticsSnapshot = {
    analytics_snapshot_id: `analytics-${randomUUID()}`,
    reel_id: input.reelId,
    publication_key: String(publication.publication_key),
    instagram_media_id: mediaId,
    observation_window: input.observationWindow,
    captured_at: capturedAt,
    source_timestamp: sourceTimestamp(metrics),
    api_version: input.apiVersion,
    status: snapshotStatus(metrics),
    metrics,
  };
  const state = openDatabase(input.config);
  try {
    insertInstagramAnalyticsSnapshot(state, { ...snapshot, metrics_json: JSON.stringify(snapshot.metrics), created_at: capturedAt });
  } finally { state.close(); }
  const reportPath = await writeInstagramAnalyticsReport(input.config, input.reelId, String(publication.publication_key), mediaId, input.apiVersion);
  return { snapshot, reportPath };
}
