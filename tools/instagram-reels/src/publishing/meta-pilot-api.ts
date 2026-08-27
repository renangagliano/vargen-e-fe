import { URLSearchParams } from "node:url";
import { sanitizeMediaUrl } from "./temporary-media.js";

export type MetaPilotApiOptions = {
  accessToken: string;
  accountId: string;
  graphApiVersion: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
};

export type MetaContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED";
export type MetaPublicationReadback = { id: string; media_type?: string; media_product_type?: string; permalink?: string; timestamp?: string; username?: string; caption?: string };
export type MetaMediaInsightValue = { value?: unknown; end_time?: string };
export type MetaMediaInsight = { name?: string; period?: string; values?: MetaMediaInsightValue[]; total_value?: { value?: unknown } };

export class MetaPilotApiError extends Error {
  public constructor(public readonly code: string, message: string, public readonly httpStatus?: number) {
    super(message);
    this.name = "MetaPilotApiError";
  }
}

function safeMessage(status: number, value: unknown): string {
  if (typeof value === "object" && value !== null && "error" in value) {
    const error = (value as { error?: { code?: unknown; type?: unknown; message?: unknown } }).error;
    const code = typeof error?.code === "string" || typeof error?.code === "number" ? String(error.code) : "UNKNOWN";
    const type = typeof error?.type === "string" ? error.type : "MetaError";
    return `${type} ${code} (HTTP ${status})`;
  }
  return `Meta API request failed (HTTP ${status})`;
}

export class MetaPilotApi {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  public constructor(private readonly options: MetaPilotApiOptions) {
    this.baseUrl = (options.baseUrl ?? "https://graph.instagram.com").replace(/\/$/, "");
    this.fetcher = options.fetcher ?? fetch;
    if (!options.accessToken.trim()) throw new MetaPilotApiError("AUTHENTICATION_ERROR", "Instagram access token is required.");
    if (!options.accountId.trim()) throw new MetaPilotApiError("CONFIGURATION_ERROR", "Instagram account ID is required.");
  }

  private endpoint(id: string, query?: URLSearchParams): string { const pathValue = id.split("/").map((part) => encodeURIComponent(part)).join("/"); return `${this.baseUrl}/${this.options.graphApiVersion}/${pathValue}${query && query.toString() ? `?${query.toString()}` : ""}`; }

  private async request(id: string, init: RequestInit = {}, query?: URLSearchParams): Promise<Record<string, unknown>> {
    const response = await this.fetcher(this.endpoint(id, query), { ...init, headers: { Authorization: `Bearer ${this.options.accessToken}`, ...(init.headers ?? {}) } });
    let body: unknown = null;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok) throw new MetaPilotApiError("META_API_ERROR", safeMessage(response.status, body), response.status);
    if (!body || typeof body !== "object") throw new MetaPilotApiError("META_API_ERROR", "Meta API returned an invalid response.", response.status);
    return body as Record<string, unknown>;
  }

  async createReelContainer(input: { videoUrl: string; caption: string }): Promise<{ containerId: string; safeMediaUrl: string }> {
    if (!input.videoUrl.startsWith("https://")) throw new MetaPilotApiError("MEDIA_URL_INVALID", "A public HTTPS media URL is required.");
    const body = new URLSearchParams({ media_type: "REELS", video_url: input.videoUrl, caption: input.caption });
    const response = await this.request(`${this.options.accountId}/media`, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
    const id = typeof response.id === "string" ? response.id : null;
    if (!id) throw new MetaPilotApiError("CONTAINER_CREATION_ERROR", "Meta did not return a container identifier.");
    return { containerId: id, safeMediaUrl: sanitizeMediaUrl(input.videoUrl) };
  }

  async getContainerStatus(containerId: string): Promise<{ status: MetaContainerStatus; errorMessageSafe?: string }> {
    const response = await this.request(containerId, { method: "GET", headers: { "content-type": "application/json" } }, new URLSearchParams({ fields: "status_code,status" }));
    const raw = String(response.status_code ?? response.status ?? "IN_PROGRESS").toUpperCase();
    if (raw === "FINISHED") return { status: "FINISHED" };
    if (raw === "ERROR") return { status: "ERROR", errorMessageSafe: "Meta reported remote media processing failure." };
    if (raw === "EXPIRED") return { status: "EXPIRED", errorMessageSafe: "Meta reported an expired media container." };
    return { status: "IN_PROGRESS" };
  }

  async publishContainer(containerId: string): Promise<{ mediaId: string }> {
    const body = new URLSearchParams({ creation_id: containerId });
    const response = await this.request(`${this.options.accountId}/media_publish`, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
    const id = typeof response.id === "string" ? response.id : null;
    if (!id) throw new MetaPilotApiError("MEDIA_PUBLISH_ERROR", "Meta did not return a media identifier.");
    return { mediaId: id };
  }

  async readPublication(mediaId: string): Promise<MetaPublicationReadback> {
    const response = await this.request(mediaId, { method: "GET", headers: { "content-type": "application/json" } }, new URLSearchParams({ fields: "id,media_type,media_product_type,permalink,timestamp,username,caption" }));
    return { id: typeof response.id === "string" ? response.id : mediaId, media_type: typeof response.media_type === "string" ? response.media_type : undefined, media_product_type: typeof response.media_product_type === "string" ? response.media_product_type : undefined, permalink: typeof response.permalink === "string" ? response.permalink : undefined, timestamp: typeof response.timestamp === "string" ? response.timestamp : undefined, username: typeof response.username === "string" ? response.username : undefined, caption: typeof response.caption === "string" ? response.caption : undefined };
  }

  async getMediaInsights(mediaId: string, metric: string): Promise<MetaMediaInsight[]> {
    const response = await this.request(`${mediaId}/insights`, { method: "GET", headers: { "content-type": "application/json" } }, new URLSearchParams({ metric }));
    return Array.isArray(response.data) ? response.data.filter((value): value is MetaMediaInsight => typeof value === "object" && value !== null) : [];
  }
}
