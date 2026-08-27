import "server-only";

import { URLSearchParams } from "node:url";
import type { PublicationMetaGateway } from "@vargenfe/admin-shared/admin/publication-orchestrator";
import type { PublicationAnalytics } from "@vargenfe/admin-shared/admin/publication-contract";

export class MetaPublicationError extends Error {
  public constructor(public readonly code: string, message = code) { super(message); }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new MetaPublicationError("META_CONFIGURATION_REQUIRED");
  return value;
}

function safeMessage(status: number, body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: { type?: unknown; code?: unknown } }).error;
    return `${typeof error?.type === "string" ? error.type : "MetaError"} ${String(error?.code ?? "UNKNOWN")} (HTTP ${status})`;
  }
  return `Meta request failed (HTTP ${status})`;
}

function graphBase(): string {
  const base = (process.env.META_GRAPH_API_BASE_URL?.trim() || "https://graph.instagram.com").replace(/\/$/, "");
  const url = new URL(base);
  if (url.protocol !== "https:" || !["graph.instagram.com", "graph.facebook.com"].includes(url.hostname.toLowerCase())) throw new MetaPublicationError("META_GRAPH_API_URL_INVALID");
  return base;
}

export class AdminMetaPublicationClient implements PublicationMetaGateway {
  private readonly token: string;
  private readonly accountId: string;
  private readonly version: string;
  private readonly base: string;
  public constructor(private readonly fetcher: typeof fetch = fetch) {
    this.token = required("INSTAGRAM_ACCESS_TOKEN");
    this.accountId = required("INSTAGRAM_ACCOUNT_ID");
    required("META_APP_ID");
    this.version = required("META_GRAPH_API_VERSION");
    this.base = graphBase();
  }

  private async request(id: string, init: RequestInit = {}, params?: URLSearchParams): Promise<Record<string, unknown>> {
    const path = id.split("/").map(encodeURIComponent).join("/");
    const url = `${this.base}/${this.version}/${path}${params && params.toString() ? `?${params}` : ""}`;
    const response = await this.fetcher(url, { ...init, headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) } });
    const text = await response.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : {}; } catch { body = null; }
    if (!response.ok) throw new MetaPublicationError("META_API_ERROR", safeMessage(response.status, body));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new MetaPublicationError("META_API_ERROR");
    return body as Record<string, unknown>;
  }

  async createReelContainer(input: { videoUrl: string; caption: string }): Promise<{ containerId: string }> {
    if (!input.videoUrl.startsWith("https://")) throw new MetaPublicationError("TEMP_MEDIA_VALIDATION_FAILED");
    const body = new URLSearchParams({ media_type: "REELS", video_url: input.videoUrl, caption: input.caption });
    const response = await this.request(`${this.accountId}/media`, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
    if (typeof response.id !== "string" || !response.id) throw new MetaPublicationError("META_CONTAINER_CREATE_FAILED");
    return { containerId: response.id };
  }

  async getContainerStatus(containerId: string) {
    const response = await this.request(containerId, { method: "GET" }, new URLSearchParams({ fields: "status_code,status" }));
    const status = String(response.status_code ?? response.status ?? "IN_PROGRESS").toUpperCase();
    if (status === "FINISHED") return { status: "FINISHED" as const };
    if (status === "ERROR") return { status: "ERROR" as const, errorMessageSafe: "O Instagram reportou erro no processamento." };
    if (status === "EXPIRED") return { status: "EXPIRED" as const, errorMessageSafe: "O container do Instagram expirou." };
    return { status: "IN_PROGRESS" as const };
  }

  async publishContainer(containerId: string): Promise<{ mediaId: string }> {
    const response = await this.request(`${this.accountId}/media_publish`, { method: "POST", body: new URLSearchParams({ creation_id: containerId }), headers: { "content-type": "application/x-www-form-urlencoded" } });
    if (typeof response.id !== "string" || !response.id) throw new MetaPublicationError("MEDIA_PUBLISH_FAILED");
    return { mediaId: response.id };
  }

  async readPublication(mediaId: string) {
    const response = await this.request(mediaId, { method: "GET" }, new URLSearchParams({ fields: "id,media_product_type,permalink,timestamp,username" }));
    return { id: typeof response.id === "string" ? response.id : mediaId, media_product_type: typeof response.media_product_type === "string" ? response.media_product_type : undefined, permalink: typeof response.permalink === "string" ? response.permalink : undefined, timestamp: typeof response.timestamp === "string" ? response.timestamp : undefined, username: typeof response.username === "string" ? response.username : undefined };
  }

  async getMediaInsights(mediaId: string): Promise<PublicationAnalytics> {
    const response = await this.request(`${mediaId}/insights`, { method: "GET" }, new URLSearchParams({ metric: "views,reach,likes,comments,saved,shares" }));
    return { status: "AVAILABLE", metrics: Array.isArray(response.data) ? response.data : [] };
  }
}
