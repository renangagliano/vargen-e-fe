import crypto from "node:crypto";
import fs from "node:fs/promises";
import type { MediaConfig } from "../config/index.js";
import { expiredTemporaryMedia, openDatabase, temporaryMediaByIdentity, temporaryMediaByReel, updateTemporaryMediaStatus, upsertTemporaryMedia } from "../database/db.js";
import { sha256File } from "../media/checksum.js";
import { resolveReviewFile } from "../review/files.js";
import { audit } from "./audit.js";
import type { TemporaryMediaPreparationInput, TemporaryMediaPreparationResult, TemporaryMediaProvider, TemporaryMediaValidationResult } from "./media-provider.js";
import { sanitizeMediaUrl } from "./temporary-media.js";

export const ONEDRIVE_PERSONAL_TEMPORARY_MEDIA_PROVIDER = "onedrive-personal" as const;
export const ONEDRIVE_PERSONAL_TEMPORARY_ROOT = "VargenFe/InstagramTemp" as const;
export const ONEDRIVE_PERSONAL_URL_TTL_MINUTES = 60;
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const MAX_REDIRECTS = 5;

export type PersonalGraphTokenProvider = { getAccessToken(): Promise<string> };

export type OneDriveDrive = {
  id?: string;
  driveType?: string;
  owner?: { user?: { id?: string; displayName?: string; email?: string } };
};

export type OneDriveDriveItem = {
  id: string;
  name: string;
  size?: number;
  file?: { mimeType?: string; hashes?: { sha256Hash?: string } };
  webUrl?: string;
  parentReference?: { path?: string };
  "@microsoft.graph.downloadUrl"?: string;
};

export type OneDriveAnonymousResponse = {
  status: number;
  headers: Headers;
  url: string;
  body?: Uint8Array;
  bodyStream?: AsyncIterable<Uint8Array>;
  location?: string;
};

export type OneDriveAnonymousFetcher = (url: string, options?: { range?: string }) => Promise<OneDriveAnonymousResponse>;

export type OneDrivePersonalGraphClient = {
  getDrive(): Promise<OneDriveDrive>;
  getItemByPath(itemPath: string): Promise<OneDriveDriveItem | null>;
  listChildren?(folderPath: string): Promise<OneDriveDriveItem[]>;
  ensureFolder(folderPath: string): Promise<OneDriveDriveItem>;
  uploadSmallFile(itemPath: string, localPath: string): Promise<OneDriveDriveItem>;
  getItemById(itemId: string): Promise<OneDriveDriveItem>;
  createAnonymousViewLink(itemId: string, expirationDateTime: string): Promise<{ permissionId?: string; webUrl: string }>;
  deleteItem(itemId: string): Promise<void>;
  deletePermission(itemId: string, permissionId: string): Promise<void>;
};

export type OneDrivePersonalTemporaryMediaDependencies = {
  graph?: OneDrivePersonalGraphClient;
  tokenProvider?: PersonalGraphTokenProvider;
  fetcher?: OneDriveAnonymousFetcher;
  now?: () => Date;
};

function safeErrorCode(error: unknown): string {
  const value = error as { code?: unknown; status?: unknown; statusCode?: unknown };
  const code = typeof value?.code === "string" ? value.code : typeof value?.status === "number" ? `GRAPH_HTTP_${value.status}` : typeof value?.statusCode === "number" ? `GRAPH_HTTP_${value.statusCode}` : "GRAPH_API_ERROR";
  return code.replace(/[^A-Z0-9_-]/gi, "_").slice(0, 80);
}

function isNotFound(error: unknown): boolean {
  const value = error as { status?: unknown; statusCode?: unknown };
  return value?.status === 404 || value?.statusCode === 404;
}

function validIdentity(value: string, name: string): void {
  if (!value || !/^[A-Za-z0-9._:-]+$/.test(value) || value.includes("..")) throw new Error(`${name}_INVALID`);
}

function itemPathFor(input: TemporaryMediaPreparationInput): string {
  validIdentity(input.reelId, "REEL_ID");
  if (!/^[a-f0-9]{64}$/i.test(input.derivedChecksum)) throw new Error("DERIVED_CHECKSUM_INVALID");
  return `${ONEDRIVE_PERSONAL_TEMPORARY_ROOT}/${input.reelId}/${input.derivedChecksum.slice(0, 16).toLowerCase()}.mp4`;
}

function redactedUrl(value: string): string { return sanitizeMediaUrl(value); }

function isTrustedDeliveryHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "1drv.ms" || host === "onedrive.com" || host.endsWith(".onedrive.com") || host === "live.com" || host.endsWith(".live.com") || host === "1drv.com" || host.endsWith(".1drv.com") || host === "microsoftpersonalcontent.com" || host.endsWith(".microsoftpersonalcontent.com");
}

function isRedirect(status: number): boolean { return [301, 302, 303, 307, 308].includes(status); }

function contentType(headers: Headers): string | null { return headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? null; }

function contentLength(headers: Headers, body?: Uint8Array): number | null {
  const value = headers.get("content-length");
  if (value && /^\d+$/.test(value)) return Number(value);
  return body ? body.byteLength : null;
}

function looksLikeMp4(body: Uint8Array | undefined): boolean {
  if (!body || body.byteLength < 8) return false;
  return String.fromCharCode(...body.slice(4, 8)) === "ftyp";
}

async function defaultAnonymousFetcher(url: string, options: { range?: string } = {}): Promise<OneDriveAnonymousResponse> {
  const response = await fetch(url, { method: "GET", redirect: "manual", headers: options.range ? { Range: options.range } : {} });
  const bodyStream = response.status >= 200 && response.status < 300 && response.body ? response.body as unknown as AsyncIterable<Uint8Array> : undefined;
  return { status: response.status, headers: response.headers, url, bodyStream, location: response.headers.get("location") ?? undefined };
}

type DownloadTrace = {
  response: OneDriveAnonymousResponse;
  hosts: string[];
  statuses: number[];
  error?: "UNTRUSTED_REDIRECT" | "REDIRECT_NOT_ALLOWED" | "NETWORK_ERROR";
};

async function followAnonymousUrl(url: string, fetcher: OneDriveAnonymousFetcher, range?: string): Promise<DownloadTrace> {
  let current = url;
  const hosts: string[] = [];
  const statuses: number[] = [];
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:" || !isTrustedDeliveryHost(parsed.hostname)) return { response: { status: 0, headers: new Headers(), url: current }, hosts, statuses, error: "UNTRUSTED_REDIRECT" };
    hosts.push(parsed.hostname);
    let response: OneDriveAnonymousResponse;
    try {
      response = await fetcher(current, range ? { range } : {});
    } catch {
      return { response: { status: 0, headers: new Headers(), url: current }, hosts, statuses, error: "NETWORK_ERROR" };
    }
    statuses.push(response.status);
    if (!isRedirect(response.status)) return { response, hosts, statuses };
    const location = response.location ?? response.headers.get("location") ?? undefined;
    if (!location) return { response, hosts, statuses, error: "REDIRECT_NOT_ALLOWED" };
    if (hop === MAX_REDIRECTS) return { response, hosts, statuses, error: "REDIRECT_NOT_ALLOWED" };
    current = new URL(location, current).toString();
  }
  return { response: { status: 0, headers: new Headers(), url: current }, hosts, statuses, error: "REDIRECT_NOT_ALLOWED" };
}

type BodyInspection = { length: number; firstBytes: Uint8Array; kind: "BINARY" | "HTML" | "JSON" | "EMPTY" | "UNKNOWN"; checksum?: string };

async function inspectBody(response: OneDriveAnonymousResponse, hash = false): Promise<BodyInspection> {
  const digest = hash ? crypto.createHash("sha256") : undefined;
  const first = new Uint8Array(16);
  let firstLength = 0;
  let length = 0;
  const consume = (chunk: Uint8Array): void => {
    if (chunk.byteLength === 0) return;
    const take = Math.min(first.byteLength - firstLength, chunk.byteLength);
    if (take > 0) first.set(chunk.slice(0, take), firstLength);
    firstLength += take;
    length += chunk.byteLength;
    digest?.update(chunk);
  };
  if (response.body) consume(response.body);
  else if (response.bodyStream) for await (const chunk of response.bodyStream) consume(chunk);
  const firstBytes = first.slice(0, firstLength);
  const type = contentType(response.headers);
  const text = new TextDecoder().decode(firstBytes).trimStart().toLowerCase();
  const kind = type === "text/html" || type === "application/xhtml+xml" || text.startsWith("<html") || text.startsWith("<!doctype html") ? "HTML" : type === "application/json" || text.startsWith("{") || text.startsWith("[") ? "JSON" : length === 0 ? "EMPTY" : looksLikeMp4(firstBytes) || type === "video/mp4" || type === "application/mp4" || type === "application/octet-stream" ? "BINARY" : "UNKNOWN";
  return { length, firstBytes, kind, ...(digest ? { checksum: digest.digest("hex").toUpperCase() } : {}) };
}

function contentRangeTotal(headers: Headers): number | null {
  const value = headers.get("content-range")?.trim();
  const match = value?.match(/^bytes\s+\d+-\d+\/(\d+|\*)$/i);
  return match && match[1] !== "*" ? Number(match[1]) : null;
}

function diagnostics(range: DownloadTrace, full: DownloadTrace, body: BodyInspection | undefined, type: string | null, size: number | null, contentRange: string | null): NonNullable<TemporaryMediaValidationResult["diagnostics"]> {
  const allStatuses = [...range.statuses, ...full.statuses];
  const allHosts = [...range.hosts, ...full.hosts];
  const final = full.response.status ? full.response : range.response;
  return { initialMethod: "GET", initialStatus: range.statuses[0] ?? full.statuses[0] ?? null, redirectStatuses: allStatuses.filter(isRedirect), redirectHosts: allHosts, finalStatus: final.status || null, finalHostname: (() => { try { return new URL(final.url).hostname; } catch { return null; } })(), contentType: type, contentLength: size, contentRange, acceptRanges: final.headers.get("accept-ranges"), bodyKind: body?.kind ?? "UNKNOWN", authorizationHeaderSent: false };
}

export async function validateOneDriveAnonymousDownload(input: {
  url: string;
  expectedSize: number;
  expectedChecksum: string;
  expectedMimeType?: string | null;
  expectedFileName?: string;
  now: Date;
  fetcher: OneDriveAnonymousFetcher;
  expiresAt: string;
}): Promise<TemporaryMediaValidationResult> {
  let parsed: URL;
  try { parsed = new URL(input.url); } catch { return { ok: false, code: "DIRECT_DOWNLOAD_UNAVAILABLE", safeUrl: "[invalid-url]", contentType: null, contentLength: null, expectedSize: input.expectedSize, expiresAt: input.expiresAt, rangeSupport: "UNKNOWN" }; }
  const safeUrl = redactedUrl(input.url);
  if (parsed.protocol !== "https:" || !isTrustedDeliveryHost(parsed.hostname)) return { ok: false, code: "PUBLIC_URL_REQUIRED", safeUrl, contentType: null, contentLength: null, expectedSize: input.expectedSize, expiresAt: input.expiresAt, rangeSupport: "UNKNOWN" };

  const rangeResult = await followAnonymousUrl(input.url, input.fetcher, "bytes=0-1023");
  const result = await followAnonymousUrl(input.url, input.fetcher);
  const type = contentType(result.response.headers);
  const rangeBody = rangeResult.response.status >= 200 && rangeResult.response.status < 300 ? await inspectBody(rangeResult.response) : undefined;
  const rangeTotal = rangeResult.response.status === 206 ? contentRangeTotal(rangeResult.response.headers) : null;
  const rangeSupport = rangeResult.error ? "UNKNOWN" : rangeResult.response.status === 206 && rangeTotal !== null ? "SUPPORTED" : rangeResult.response.status === 200 ? "NOT_SUPPORTED" : "UNKNOWN";
  const body = result.response.status >= 200 && result.response.status < 300 ? await inspectBody(result.response, true) : undefined;
  const size = contentLength(result.response.headers) ?? (result.response.status === 206 ? contentRangeTotal(result.response.headers) : body?.length ?? null);
  const common = { safeUrl, contentType: type, contentLength: size, expectedSize: input.expectedSize, expiresAt: input.expiresAt, rangeSupport, redirectChain: result.hosts, diagnostics: diagnostics(rangeResult, result, body ?? rangeBody, type, size, result.response.headers.get("content-range")) } as const;
  if (rangeResult.error === "UNTRUSTED_REDIRECT" || result.error === "UNTRUSTED_REDIRECT") return { ok: false, code: "ONEDRIVE_DOWNLOAD_REDIRECT_UNTRUSTED", ...common };
  if (rangeResult.error === "NETWORK_ERROR" || result.error === "NETWORK_ERROR") return { ok: false, code: "ONEDRIVE_DOWNLOAD_NETWORK_ERROR", ...common };
  if (rangeResult.error || result.error) return { ok: false, code: "REDIRECT_NOT_ALLOWED", ...common };
  if (![200, 206].includes(rangeResult.response.status) || ![200, 206].includes(result.response.status)) {
    const status = result.response.status || rangeResult.response.status;
    return { ok: false, code: status === 401 || status === 403 ? "ONEDRIVE_DOWNLOAD_URL_EXPIRED" : "ONEDRIVE_DOWNLOAD_HTTP_STATUS", ...common };
  }
  if (body?.kind === "HTML" || body?.kind === "JSON") return { ok: false, code: "ONEDRIVE_DOWNLOAD_HTML_RESPONSE", ...common };
  if (rangeResult.response.status === 206 && (rangeTotal === null || rangeTotal !== input.expectedSize)) return { ok: false, code: "ONEDRIVE_DOWNLOAD_SIZE_MISMATCH", ...common };
  const expectedMime = input.expectedMimeType?.toLowerCase() ?? "";
  const fileLooksMp4 = input.expectedFileName?.toLowerCase().endsWith(".mp4") || expectedMime === "video/mp4";
  if (!type || (!["video/mp4", "application/mp4"].includes(type) && !(type === "application/octet-stream" && fileLooksMp4 && body?.kind === "BINARY"))) return { ok: false, code: "CONTENT_TYPE_INVALID", ...common };
  const remoteSize = result.response.status === 206 ? contentRangeTotal(result.response.headers) : contentLength(result.response.headers) ?? body?.length ?? null;
  if (remoteSize === null || remoteSize <= 0 || remoteSize !== input.expectedSize) return { ok: false, code: "ONEDRIVE_DOWNLOAD_SIZE_MISMATCH", ...common };
  if (!body || body.kind !== "BINARY" || !looksLikeMp4(body.firstBytes)) return { ok: false, code: "ONEDRIVE_DOWNLOAD_HTML_RESPONSE", ...common };
  const checksum = body.checksum ?? "";
  if (checksum !== input.expectedChecksum.toUpperCase()) return { ok: false, code: "ONEDRIVE_DOWNLOAD_CHECKSUM_MISMATCH", checksumSha256: checksum, ...common };
  return { ok: true, code: "PASS", checksumSha256: checksum, ...common };
}

async function graphJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`GRAPH_HTTP_${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return body ? JSON.parse(body) as Record<string, unknown> : {};
}

function itemFromJson(value: Record<string, unknown>): OneDriveDriveItem {
  if (typeof value.id !== "string" || typeof value.name !== "string") throw new Error("GRAPH_ITEM_INVALID");
  return value as unknown as OneDriveDriveItem;
}

export function createOneDrivePersonalGraphClient(tokenProvider: PersonalGraphTokenProvider): OneDrivePersonalGraphClient {
  const request = async (method: string, route: string, body?: BodyInit, contentTypeValue?: string): Promise<Record<string, unknown>> => {
    const token = await tokenProvider.getAccessToken();
    if (!token || token.length < 20) throw new Error("PERSONAL_MICROSOFT_ACCOUNT_REQUIRED");
    const response = await fetch(`${GRAPH_ROOT}${route}`, { method, headers: { Authorization: `Bearer ${token}`, ...(contentTypeValue ? { "Content-Type": contentTypeValue } : {}) }, body });
    return graphJson(response);
  };
  const itemRoute = (itemPath: string): string => `/me/drive/root:/${itemPath.split("/").map(encodeURIComponent).join("/")}:`;
  // Graph documents this annotation with `?select=...`; using `$select` here
  // returns metadata successfully but silently omits downloadUrl.
  const itemSelect = "?select=id,name,size,file,parentReference,webUrl,@microsoft.graph.downloadUrl";
  return {
    async getDrive() { return await request("GET", "/me/drive?$select=id,driveType,owner") as unknown as OneDriveDrive; },
    async getItemByPath(itemPath) {
      try { return itemFromJson(await request("GET", `${itemRoute(itemPath)}${itemSelect}`)); } catch (error) { if (isNotFound(error)) return null; throw error; }
    },
    async listChildren(folderPath) {
      const value = await request("GET", `${itemRoute(folderPath)}/children${itemSelect}`);
      return Array.isArray(value.value) ? value.value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")).map(itemFromJson) : [];
    },
    async ensureFolder(folderPath) {
      const segments = folderPath.split("/");
      let current = "";
      let item: OneDriveDriveItem | null = null;
      for (const segment of segments) {
        current = current ? `${current}/${segment}` : segment;
        item = await this.getItemByPath(current);
        if (!item) {
          const parentRoute = current.includes("/") ? itemRoute(current.slice(0, current.lastIndexOf("/"))) : "/me/drive/root";
          item = itemFromJson(await request("POST", `${parentRoute}/children`, JSON.stringify({ name: segment, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }), "application/json"));
        }
      }
      if (!item) throw new Error("GRAPH_FOLDER_INVALID");
      return item;
    },
    async uploadSmallFile(itemPath, localPath) {
      const token = await tokenProvider.getAccessToken();
      if (!token || token.length < 20) throw new Error("PERSONAL_MICROSOFT_ACCOUNT_REQUIRED");
      const response = await fetch(`${GRAPH_ROOT}${itemRoute(itemPath)}/content`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4" }, body: await fs.readFile(localPath) });
      return itemFromJson(await graphJson(response));
    },
    async getItemById(itemId) { return itemFromJson(await request("GET", `/me/drive/items/${encodeURIComponent(itemId)}${itemSelect}`)); },
    async createAnonymousViewLink(itemId, expirationDateTime) {
      const value = await request("POST", `/me/drive/items/${encodeURIComponent(itemId)}/createLink`, JSON.stringify({ type: "view", scope: "anonymous", expirationDateTime }), "application/json");
      const link = value.link as { webUrl?: unknown } | undefined;
      if (typeof link?.webUrl !== "string") throw new Error("GRAPH_SHARE_LINK_INVALID");
      return { permissionId: typeof value.id === "string" ? value.id : undefined, webUrl: link.webUrl };
    },
    async deleteItem(itemId) { await request("DELETE", `/me/drive/items/${encodeURIComponent(itemId)}`); },
    async deletePermission(itemId, permissionId) { await request("DELETE", `/me/drive/items/${encodeURIComponent(itemId)}/permissions/${encodeURIComponent(permissionId)}`); },
  };
}

function auditTemporary(db: ReturnType<typeof openDatabase>, eventType: string, temporaryMediaId: string, reelId: string, metadata: Record<string, unknown> = {}): void {
  audit(db, { eventId: `section10.3.2:${eventType}:${temporaryMediaId}`, entityType: "TEMPORARY_MEDIA", entityId: reelId, eventType, actor: "temporary-media-provider", metadata: { temporary_media_id: temporaryMediaId, provider: ONEDRIVE_PERSONAL_TEMPORARY_MEDIA_PROVIDER, ...metadata } });
}

export function personalDriveOrThrow(drive: OneDriveDrive): { id: string } {
  if (["business", "documentLibrary", "sharePoint"].includes(String(drive.driveType))) throw new Error("CORPORATE_MICROSOFT_IDENTITY_REJECTED");
  if (drive.driveType !== "personal" || !drive.id || !drive.owner?.user) throw new Error("PERSONAL_ONEDRIVE_IDENTITY_NOT_CONFIRMED");
  return { id: drive.id };
}

function expiredAt(now: Date): string { return new Date(now.getTime() + ONEDRIVE_PERSONAL_URL_TTL_MINUTES * 60_000).toISOString(); }

export class OneDrivePersonalTemporaryMediaProvider implements TemporaryMediaProvider {
  private readonly graphClient?: OneDrivePersonalGraphClient;
  private readonly fetcher: OneDriveAnonymousFetcher;
  private readonly now: () => Date;
  private readonly permissionIds = new Map<string, string>();

  public constructor(private readonly config: MediaConfig, dependencies: OneDrivePersonalTemporaryMediaDependencies = {}) {
    this.graphClient = dependencies.graph ?? (dependencies.tokenProvider ? createOneDrivePersonalGraphClient(dependencies.tokenProvider) : undefined);
    this.fetcher = dependencies.fetcher ?? defaultAnonymousFetcher;
    this.now = dependencies.now ?? (() => new Date());
  }

  private graph(): OneDrivePersonalGraphClient {
    if (!this.graphClient) throw new Error("PERSONAL_MICROSOFT_ACCOUNT_REQUIRED");
    return this.graphClient;
  }

  private async validateIdentity(): Promise<{ id: string }> { return personalDriveOrThrow(await this.graph().getDrive()); }

  public async validateTemporaryMedia(result: TemporaryMediaPreparationResult): Promise<TemporaryMediaValidationResult> {
    if (result.provider !== ONEDRIVE_PERSONAL_TEMPORARY_MEDIA_PROVIDER || !result.url) throw new Error("ONEDRIVE_PERSONAL_REQUIRED");
    return validateOneDriveAnonymousDownload({ url: result.url, expectedSize: result.blobSize, expectedChecksum: result.derivedChecksum, expectedMimeType: "video/mp4", expectedFileName: result.blobName, now: this.now(), fetcher: this.fetcher, expiresAt: result.expiresAt });
  }

  public async prepareTemporaryMedia(input: TemporaryMediaPreparationInput): Promise<TemporaryMediaPreparationResult> {
    const output = await resolveReviewFile(this.config, input.derivedReelRelativePath);
    const initialStats = await fs.stat(output.absolutePath);
    if (!initialStats.isFile() || initialStats.size <= 0) throw new Error("DERIVED_REEL_FILE_INVALID");
    const beforeChecksum = await sha256File(output.absolutePath);
    if (beforeChecksum !== input.derivedChecksum) throw new Error("SNAPSHOT_INVALIDATED");
    const drive = await this.validateIdentity();
    const preparedAt = this.now().toISOString();
    const expiresAt = expiredAt(this.now());
    const temporaryMediaId = `temporary-media-${crypto.createHash("sha256").update(`${input.publicationKey}\n${input.derivedChecksum}`).digest("hex").slice(0, 24)}`;
    const itemPath = itemPathFor(input);
    const db = openDatabase(this.config);
    try {
      const existingRecord = temporaryMediaByIdentity(db, ONEDRIVE_PERSONAL_TEMPORARY_MEDIA_PROVIDER, input.publicationKey, input.derivedChecksum);
      auditTemporary(db, "TEMP_MEDIA_PREPARE_STARTED", temporaryMediaId, input.reelId, { item_path: itemPath, expected_size: initialStats.size });
      upsertTemporaryMedia(db, { temporary_media_id: temporaryMediaId, reel_id: input.reelId, publication_key: input.publicationKey, provider: ONEDRIVE_PERSONAL_TEMPORARY_MEDIA_PROVIDER, blob_container: drive.id, blob_name: itemPath, blob_size: initialStats.size, derived_checksum: input.derivedChecksum, prepared_at: preparedAt, expires_at: expiresAt, status: "PREPARING", cleanup_status: existingRecord?.cleanup_status ?? "NOT_REQUESTED", last_error_safe: null, drive_id: drive.id, item_path: itemPath });

      const graph = this.graph();
      await graph.ensureFolder(ONEDRIVE_PERSONAL_TEMPORARY_ROOT);
      let item = await graph.getItemByPath(itemPath);
      if (item) {
        const knownHash = item.file?.hashes?.sha256Hash;
        if (item.size !== initialStats.size || (knownHash && knownHash.toUpperCase() !== input.derivedChecksum.toUpperCase()) || (!knownHash && item.file?.mimeType !== "video/mp4")) throw new Error("ONEDRIVE_ITEM_COLLISION");
      } else {
        item = await graph.uploadSmallFile(itemPath, output.absolutePath);
        auditTemporary(db, "TEMP_MEDIA_UPLOADED", temporaryMediaId, input.reelId, { item_path: itemPath, item_id: item.id, blob_size: initialStats.size });
      }
      try {
        item = await graph.getItemById(item.id);
      } catch (error) {
        if (!isNotFound(error)) throw error;
        item = await graph.getItemByPath(itemPath);
        if (!item) throw new Error("ONEDRIVE_GRAPH_ITEM_NOT_FOUND");
      }
      const directUrl = item["@microsoft.graph.downloadUrl"];
      let url = directUrl;
      let permissionId: string | undefined;
      if (!url) {
        const link = await graph.createAnonymousViewLink(item.id, expiresAt);
        url = link.webUrl;
        permissionId = link.permissionId;
        if (permissionId) this.permissionIds.set(temporaryMediaId, permissionId);
      }
      if (!url) throw new Error("DIRECT_DOWNLOAD_UNAVAILABLE");
      const prepared: TemporaryMediaPreparationResult = { ...input, temporaryMediaId, provider: ONEDRIVE_PERSONAL_TEMPORARY_MEDIA_PROVIDER, containerName: ONEDRIVE_PERSONAL_TEMPORARY_ROOT, blobName: itemPath, driveId: drive.id, itemId: item.id, itemPath, blobSize: initialStats.size, preparedAt, expiresAt, state: "SAS_CREATED", cleanupStatus: "NOT_REQUESTED", url, safeUrl: redactedUrl(url), validation: { ok: false, code: "HTTP_ERROR", safeUrl: redactedUrl(url), contentType: null, contentLength: null, expectedSize: initialStats.size, expiresAt } };
      const validation = await this.validateTemporaryMedia(prepared);
      const afterChecksum = await sha256File(output.absolutePath);
      if (afterChecksum !== input.derivedChecksum) throw new Error("SNAPSHOT_INVALIDATED");
      if (!validation.ok) {
        upsertTemporaryMedia(db, { temporary_media_id: temporaryMediaId, reel_id: input.reelId, publication_key: input.publicationKey, provider: ONEDRIVE_PERSONAL_TEMPORARY_MEDIA_PROVIDER, blob_container: drive.id, blob_name: itemPath, blob_size: initialStats.size, derived_checksum: input.derivedChecksum, prepared_at: preparedAt, expires_at: expiresAt, status: "FAILED", cleanup_status: "PENDING", last_error_safe: validation.code, drive_id: drive.id, item_id: item.id, item_path: itemPath, permission_id: permissionId ?? null });
        auditTemporary(db, "TEMP_MEDIA_FAILED", temporaryMediaId, input.reelId, { code: validation.code, validation: { content_type: validation.contentType, content_length: validation.contentLength, expected_size: validation.expectedSize, range_support: validation.rangeSupport ?? "UNKNOWN", redirect_chain: validation.redirectChain ?? [], diagnostics: validation.diagnostics ?? null } });
        throw new Error(`TEMPORARY_MEDIA_VALIDATION_FAILED:${validation.code}`);
      }
      upsertTemporaryMedia(db, { temporary_media_id: temporaryMediaId, reel_id: input.reelId, publication_key: input.publicationKey, provider: ONEDRIVE_PERSONAL_TEMPORARY_MEDIA_PROVIDER, blob_container: drive.id, blob_name: itemPath, blob_size: initialStats.size, derived_checksum: input.derivedChecksum, prepared_at: preparedAt, expires_at: expiresAt, status: "VALIDATED", cleanup_status: "NOT_REQUESTED", last_error_safe: null, drive_id: drive.id, item_id: item.id, item_path: itemPath, permission_id: permissionId ?? null });
      auditTemporary(db, "TEMP_MEDIA_VALIDATED", temporaryMediaId, input.reelId, { item_path: itemPath, item_id: item.id, blob_size: initialStats.size, expires_at: expiresAt, direct_download: Boolean(directUrl), sharing_permission: Boolean(permissionId) });
      return { ...prepared, state: "VALIDATED", validation };
    } catch (error) {
      const code = error instanceof Error && error.message.startsWith("TEMPORARY_MEDIA_VALIDATION_FAILED:") ? error.message.slice("TEMPORARY_MEDIA_VALIDATION_FAILED:".length) : safeErrorCode(error);
      try { updateTemporaryMediaStatus(db, temporaryMediaId, "FAILED", "PENDING", code); } catch { /* preserve original failure */ }
      throw error;
    } finally { db.close(); }
  }

  public async getTemporaryPublicUrl(reelId: string): Promise<{ url: string; provider: string; checksumSha256?: string; expiresAt?: string }> {
    const db = openDatabase(this.config);
    let snapshot: { reel_id: string; publication_key: string; derived_reel_relative_path: string; derived_reel_checksum: string; editorial_version: number };
    try {
      const row = db.prepare("SELECT snapshot_json FROM pilot_snapshots WHERE reel_id = ? AND status = 'FROZEN' ORDER BY created_at DESC LIMIT 1").get(reelId) as { snapshot_json?: string } | undefined;
      if (!row?.snapshot_json) throw new Error("TEMPORARY_MEDIA_SNAPSHOT_REQUIRED");
      snapshot = JSON.parse(row.snapshot_json) as { reel_id: string; publication_key: string; derived_reel_relative_path: string; derived_reel_checksum: string; editorial_version: number };
    } finally { db.close(); }
    const prepared = await this.prepareTemporaryMedia({ reelId: snapshot.reel_id, publicationKey: snapshot.publication_key, derivedReelRelativePath: snapshot.derived_reel_relative_path, derivedChecksum: snapshot.derived_reel_checksum, editorialVersion: snapshot.editorial_version });
    return { url: prepared.url, provider: prepared.provider, checksumSha256: prepared.derivedChecksum, expiresAt: prepared.expiresAt };
  }

  public async revokeTemporaryPublicUrl(reelId: string, _url: string): Promise<void> {
    const db = openDatabase(this.config);
    try {
      const row = temporaryMediaByReel(db, reelId);
      if (!row || row.provider !== ONEDRIVE_PERSONAL_TEMPORARY_MEDIA_PROVIDER) return;
      const item = row.item_id ? await this.graph().getItemById(row.item_id) : await this.graph().getItemByPath(row.item_path ?? row.blob_name);
      if (item) {
        const permissionId = row.permission_id ?? this.permissionIds.get(row.temporary_media_id);
        if (permissionId) await this.graph().deletePermission(item.id, permissionId);
        await this.graph().deleteItem(item.id);
      }
      updateTemporaryMediaStatus(db, row.temporary_media_id, "CLEANED", "CLEANED");
      auditTemporary(db, "TEMP_MEDIA_CLEANED", row.temporary_media_id, reelId, { item_path: row.blob_name });
    } finally { db.close(); }
  }

  public async cleanupExpiredMedia(): Promise<number> {
    const db = openDatabase(this.config);
    let cleaned = 0;
    try {
      const rows = expiredTemporaryMedia(db, ONEDRIVE_PERSONAL_TEMPORARY_MEDIA_PROVIDER, ONEDRIVE_PERSONAL_TEMPORARY_ROOT, this.now().toISOString());
      for (const row of rows) {
        updateTemporaryMediaStatus(db, row.temporary_media_id, "EXPIRED", "PENDING");
        const item = row.item_id ? await this.graph().getItemById(row.item_id) : await this.graph().getItemByPath(row.item_path ?? row.blob_name);
        if (item) await this.graph().deleteItem(item.id);
        updateTemporaryMediaStatus(db, row.temporary_media_id, "CLEANED", "CLEANED");
        auditTemporary(db, "TEMP_MEDIA_CLEANED", row.temporary_media_id, row.reel_id, { item_path: row.blob_name });
        cleaned += 1;
      }
      return cleaned;
    } finally { db.close(); }
  }
}
