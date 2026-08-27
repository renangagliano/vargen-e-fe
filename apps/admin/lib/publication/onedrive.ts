import "server-only";

import crypto from "node:crypto";
import type { PublicationMediaGateway, PreparedPublicationMedia } from "@vargenfe/admin-shared/admin/publication-orchestrator";
import type { PublicationSnapshot } from "@vargenfe/admin-shared/admin/publication-contract";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const TEMP_ROOT = "VargenFe/InstagramTemp";
const TRUSTED_HOSTS = ["1drv.ms", "1drv.com", "onedrive.com", "live.com", "microsoftpersonalcontent.com"];

export class OneDrivePublicationError extends Error {
  public constructor(public readonly code: string, message = code) { super(message); }
}

function trustedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return TRUSTED_HOSTS.some((value) => host === value || host.endsWith(`.${value}`));
}

function requiredToken(): string {
  const value = process.env.MICROSOFT_PERSONAL_ACCESS_TOKEN?.trim();
  if (!value) throw new OneDrivePublicationError("ONEDRIVE_AUTH_REQUIRED");
  return value;
}

function itemPath(snapshot: PublicationSnapshot): string {
  if (snapshot.temporary_media_path) return snapshot.temporary_media_path;
  return `${TEMP_ROOT}/${snapshot.reel_id}/${snapshot.source_checksum.slice(0, 16).toLowerCase()}.mp4`;
}

type DriveItem = { id: string; name: string; size?: number; file?: { mimeType?: string; hashes?: { sha256Hash?: string } }; [key: string]: unknown };

export class OneDrivePublicationMediaGateway implements PublicationMediaGateway {
  private readonly token: string;
  public constructor(private readonly fetcher: typeof fetch = fetch) { this.token = requiredToken(); }

  private async graph(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const response = await this.fetcher(`${GRAPH_ROOT}${path}`, { ...init, headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) } });
    const body = await response.text();
    let json: unknown = null;
    try { json = body ? JSON.parse(body) : {}; } catch { json = null; }
    if (!response.ok) throw new OneDrivePublicationError(response.status === 404 ? "ONEDRIVE_TEMP_MEDIA_NOT_FOUND" : "ONEDRIVE_GRAPH_ERROR");
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new OneDrivePublicationError("ONEDRIVE_GRAPH_RESPONSE_INVALID");
    return json as Record<string, unknown>;
  }

  private async getItemByPath(pathValue: string): Promise<DriveItem> {
    const path = pathValue.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    return await this.graph(`/me/drive/root:/${path}:?%24select=id,name,size,file,%40microsoft.graph.downloadUrl`) as unknown as DriveItem;
  }

  private async getItemById(id: string): Promise<DriveItem> {
    return await this.graph(`/me/drive/items/${encodeURIComponent(id)}?%24select=id,name,size,file,%40microsoft.graph.downloadUrl`) as unknown as DriveItem;
  }

  private async listChildren(pathValue: string): Promise<DriveItem[]> {
    const path = pathValue.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    const result = await this.graph(`/me/drive/root:/${path}:/children?%24select=id,name,size,file,%40microsoft.graph.downloadUrl`);
    return Array.isArray(result.value) ? result.value.filter((value): value is DriveItem => Boolean(value && typeof value === "object" && !Array.isArray(value))).map((value) => value as DriveItem) : [];
  }

  private async resolveMediaItem(snapshot: PublicationSnapshot): Promise<DriveItem> {
    try { return await this.getItemByPath(itemPath(snapshot)); }
    catch (error) {
      if (!(error instanceof OneDrivePublicationError) || error.code !== "ONEDRIVE_TEMP_MEDIA_NOT_FOUND") throw error;
      const candidates = (await this.listChildren(`${TEMP_ROOT}/${snapshot.reel_id}`)).filter((item) => item.name.toLowerCase().endsWith(".mp4") && item.size === snapshot.media_size);
      if (candidates.length !== 1) throw new OneDrivePublicationError(candidates.length === 0 ? "ONEDRIVE_TEMP_MEDIA_NOT_FOUND" : "ONEDRIVE_TEMP_MEDIA_AMBIGUOUS");
      return candidates[0];
    }
  }

  private async freshUrl(item: DriveItem): Promise<{ url: string; permissionId?: string }> {
    if (typeof item["@microsoft.graph.downloadUrl"] === "string") return { url: item["@microsoft.graph.downloadUrl"] as string };
    const created = await this.graph(`/me/drive/items/${encodeURIComponent(item.id)}/createLink`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "view", scope: "anonymous", expirationDateTime: new Date(Date.now() + 60 * 60_000).toISOString() }) });
    const link = created.link as { webUrl?: unknown } | undefined;
    if (typeof link?.webUrl !== "string") throw new OneDrivePublicationError("ONEDRIVE_DOWNLOAD_URL_UNAVAILABLE");
    return { url: link.webUrl, permissionId: typeof created.id === "string" ? created.id : undefined };
  }

  private async validateUrl(url: string, expectedSize: number): Promise<{ checksum: string; size: number }> {
    let current = url;
    for (let hop = 0; hop <= 5; hop += 1) {
      const parsed = new URL(current);
      if (parsed.protocol !== "https:" || !trustedHost(parsed.hostname)) throw new OneDrivePublicationError("TEMP_MEDIA_VALIDATION_FAILED");
      let response: Response;
      try { response = await this.fetcher(current, { method: "GET", redirect: "manual" }); } catch { throw new OneDrivePublicationError("TEMP_MEDIA_VALIDATION_FAILED"); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || hop === 5) throw new OneDrivePublicationError("TEMP_MEDIA_VALIDATION_FAILED");
        current = new URL(location, current).toString();
        continue;
      }
      if (response.status < 200 || response.status >= 300) throw new OneDrivePublicationError("TEMP_MEDIA_VALIDATION_FAILED");
      const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (type !== "video/mp4" && type !== "application/mp4") throw new OneDrivePublicationError("TEMP_MEDIA_VALIDATION_FAILED");
      const body = new Uint8Array(await response.arrayBuffer());
      const size = Number(response.headers.get("content-length") ?? body.byteLength);
      if (!Number.isFinite(size) || size !== expectedSize || body.byteLength !== expectedSize) throw new OneDrivePublicationError("TEMP_MEDIA_VALIDATION_FAILED");
      return { checksum: crypto.createHash("sha256").update(body).digest("hex"), size };
    }
    throw new OneDrivePublicationError("TEMP_MEDIA_VALIDATION_FAILED");
  }

  async prepare(snapshot: PublicationSnapshot): Promise<PreparedPublicationMedia> {
    const drive = await this.graph("/me/drive?$select=id,driveType");
    if (drive.driveType !== "personal") throw new OneDrivePublicationError("PERSONAL_ONEDRIVE_REQUIRED");
    const item = await this.resolveMediaItem(snapshot);
    if (!item.id || item.size !== snapshot.media_size || item.file?.mimeType !== "video/mp4") throw new OneDrivePublicationError("ONEDRIVE_ITEM_COLLISION");
    const fresh = await this.freshUrl(await this.getItemById(item.id));
    const validated = await this.validateUrl(fresh.url, snapshot.media_size);
    const knownHash = item.file?.hashes?.sha256Hash;
    if (knownHash && knownHash.toLowerCase() !== validated.checksum.toLowerCase()) throw new OneDrivePublicationError("TEMP_MEDIA_CHECKSUM_MISMATCH");
    return { url: fresh.url, provider: "onedrive-personal", itemId: item.id, checksumSha256: validated.checksum, sizeBytes: validated.size, expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), cleanupAllowed: Boolean(fresh.permissionId) && process.env.INSTAGRAM_DELETE_TEMPORARY_MEDIA?.trim().toLowerCase() === "true", permissionId: fresh.permissionId ?? null };
  }

  async cleanup(media: PreparedPublicationMedia): Promise<"SUCCEEDED" | "PENDING"> {
    try {
      if (media.permissionId) await this.graph(`/me/drive/items/${encodeURIComponent(media.itemId)}/permissions/${encodeURIComponent(media.permissionId)}`, { method: "DELETE" });
      if (media.cleanupAllowed) await this.graph(`/me/drive/items/${encodeURIComponent(media.itemId)}`, { method: "DELETE" });
      return "SUCCEEDED";
    } catch { return "PENDING"; }
  }

  async cleanupSnapshot(snapshot: PublicationSnapshot): Promise<"SUCCEEDED" | "PENDING"> {
    if (!snapshot.temporary_media_item_id) return "SUCCEEDED";
    return this.cleanup({ url: "", provider: "onedrive-personal", itemId: snapshot.temporary_media_item_id, checksumSha256: snapshot.derived_checksum ?? "", sizeBytes: snapshot.media_size, expiresAt: "", cleanupAllowed: process.env.INSTAGRAM_DELETE_TEMPORARY_MEDIA?.trim().toLowerCase() === "true", permissionId: snapshot.temporary_media_permission_id ?? null });
  }
}
