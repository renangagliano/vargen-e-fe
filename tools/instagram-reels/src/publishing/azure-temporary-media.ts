import crypto from "node:crypto";
import fs from "node:fs/promises";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobSASPermissions, BlobServiceClient, generateBlobSASQueryParameters, type UserDelegationKey } from "@azure/storage-blob";
import type { MediaConfig } from "../config/index.js";
import { expiredTemporaryMedia, openDatabase, temporaryMediaByIdentity, temporaryMediaByReel, updateTemporaryMediaStatus, upsertTemporaryMedia } from "../database/db.js";
import { sha256File } from "../media/checksum.js";
import { resolveReviewFile } from "../review/files.js";
import { audit } from "./audit.js";
import { validateTemporaryMediaUrl, type TemporaryMediaUrlFetcher } from "./temporary-media.js";
import type { TemporaryMediaPreparationInput, TemporaryMediaPreparationResult, TemporaryMediaProvider, TemporaryMediaValidationResult } from "./media-provider.js";

export const AZURE_TEMPORARY_MEDIA_PROVIDER = "azure-blob-sas" as const;
export const AZURE_TEMPORARY_MEDIA_MIN_TTL_MINUTES = 15;
export const AZURE_TEMPORARY_MEDIA_MAX_TTL_MINUTES = 120;

type AzureBlobProperties = {
  contentLength: number | null;
  contentType: string | null;
  metadata: Record<string, string>;
};

type AzureBlobUploadOptions = {
  blobHTTPHeaders: { blobContentType: string; blobContentDisposition: string };
  metadata: Record<string, string>;
};

export type AzureBlobClientLike = {
  url: string;
  getProperties(): Promise<AzureBlobProperties>;
  uploadFile(filePath: string, options: AzureBlobUploadOptions): Promise<void>;
  deleteIfExists(): Promise<{ succeeded: boolean }>;
};

export type AzureStorageServiceLike = {
  getContainerProperties(containerName: string): Promise<{ publicAccess: string | null }>;
  getBlobClient(containerName: string, blobName: string): AzureBlobClientLike;
  getUserDelegationKey(startsOn: Date, expiresOn: Date): Promise<UserDelegationKey>;
};

export type AzureTemporaryMediaDependencies = {
  storage?: AzureStorageServiceLike;
  sasGenerator?: (input: { accountName: string; containerName: string; blobName: string; startsOn: Date; expiresOn: Date; userDelegationKey: UserDelegationKey }) => string;
  fetcher?: TemporaryMediaUrlFetcher;
  now?: () => Date;
};

function safeNow(dependencies: AzureTemporaryMediaDependencies): Date {
  return dependencies.now ? dependencies.now() : new Date();
}

function safeErrorCode(error: unknown): string {
  const value = error as { code?: unknown; statusCode?: unknown };
  const code = typeof value?.code === "string" ? value.code : typeof value?.statusCode === "number" ? `HTTP_${value.statusCode}` : "AZURE_API_ERROR";
  return code.replace(/[^A-Z0-9_-]/gi, "_").slice(0, 80);
}

function isNotFound(error: unknown): boolean {
  const value = error as { statusCode?: unknown; code?: unknown };
  return value?.statusCode === 404 || value?.code === "BlobNotFound" || value?.code === "ContainerNotFound";
}

function redactSasUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}?[REDACTED]`;
  } catch {
    return "[invalid-url]";
  }
}

export function azureBlobEndpoint(config: MediaConfig): string {
  if (!config.azureStorageAccountName) throw new Error("AZURE_STORAGE_ACCOUNT_REQUIRED");
  return `https://${config.azureStorageAccountName}.blob.${config.azureStorageEndpointSuffix}`;
}

function validateBlobPrefix(prefix: string): string {
  const normalized = prefix.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === ".." || !/^[A-Za-z0-9._-]+$/.test(part))) throw new Error("AZURE_STORAGE_BLOB_PREFIX_INVALID");
  return normalized;
}

function validateAzureConfiguration(config: MediaConfig): { accountName: string; containerName: string; prefix: string; ttlMinutes: number } {
  const accountName = config.azureStorageAccountName;
  if (!accountName) throw new Error("AZURE_STORAGE_ACCOUNT_REQUIRED");
  if (!/^[a-z0-9]{3,24}$/.test(accountName)) throw new Error("AZURE_STORAGE_ACCOUNT_INVALID");
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(config.azureStorageContainerName)) throw new Error("AZURE_STORAGE_CONTAINER_INVALID");
  if (!/^[a-z0-9.-]+$/.test(config.azureStorageEndpointSuffix) || config.azureStorageEndpointSuffix.includes("..")) throw new Error("AZURE_STORAGE_ENDPOINT_INVALID");
  if (config.azureStorageSasTtlMinutes < AZURE_TEMPORARY_MEDIA_MIN_TTL_MINUTES || config.azureStorageSasTtlMinutes > AZURE_TEMPORARY_MEDIA_MAX_TTL_MINUTES) throw new Error("AZURE_STORAGE_SAS_TTL_OUT_OF_RANGE");
  return { accountName, containerName: config.azureStorageContainerName, prefix: validateBlobPrefix(config.azureStorageBlobPrefix), ttlMinutes: config.azureStorageSasTtlMinutes };
}

function validIdentity(value: string, name: string): void {
  if (!value || !/^[A-Za-z0-9._-]+$/.test(value) || value.includes("..")) throw new Error(`${name}_INVALID`);
}

function blobNameFor(input: TemporaryMediaPreparationInput, prefix: string): string {
  validIdentity(input.reelId, "REEL_ID");
  if (!/^[a-f0-9]{64}$/i.test(input.derivedChecksum)) throw new Error("DERIVED_CHECKSUM_INVALID");
  return `${prefix}/${input.reelId}/${input.derivedChecksum.slice(0, 16).toLowerCase()}.mp4`;
}

function metadataFor(input: TemporaryMediaPreparationInput, preparedAt: string, expiresAt: string): Record<string, string> {
  return {
    "reel-id": input.reelId,
    "publication-key": input.publicationKey,
    "derived-checksum": input.derivedChecksum,
    "editorial-version": String(input.editorialVersion),
    "created-at": preparedAt,
    "expiry-at": expiresAt,
  };
}

function defaultSasGenerator(input: { accountName: string; containerName: string; blobName: string; startsOn: Date; expiresOn: Date; userDelegationKey: UserDelegationKey }): string {
  return generateBlobSASQueryParameters({
    containerName: input.containerName,
    blobName: input.blobName,
    permissions: BlobSASPermissions.parse("r"),
    startsOn: input.startsOn,
    expiresOn: input.expiresOn,
    protocol: "https" as NonNullable<Parameters<typeof generateBlobSASQueryParameters>[0]["protocol"]>,
  }, input.userDelegationKey, input.accountName).toString();
}

function defaultStorage(config: MediaConfig): AzureStorageServiceLike {
  const endpoint = azureBlobEndpoint(config);
  const service = new BlobServiceClient(endpoint, new DefaultAzureCredential());
  return {
    getContainerProperties: async (containerName) => {
      const response = await service.getContainerClient(containerName).getProperties();
      return { publicAccess: response.blobPublicAccess ?? null };
    },
    getBlobClient: (containerName, blobName) => {
      const blob = service.getContainerClient(containerName).getBlockBlobClient(blobName);
      return {
        url: blob.url,
        getProperties: async () => {
          const response = await blob.getProperties();
          return { contentLength: response.contentLength ?? null, contentType: response.contentType ?? null, metadata: response.metadata ?? {} };
        },
        uploadFile: async (filePath, options) => {
          await blob.uploadFile(filePath, { conditions: { ifNoneMatch: "*" }, blobHTTPHeaders: options.blobHTTPHeaders, metadata: options.metadata });
        },
        deleteIfExists: async () => blob.deleteIfExists(),
      };
    },
    getUserDelegationKey: async (startsOn, expiresOn) => service.getUserDelegationKey(startsOn, expiresOn),
  };
}

function auditTemporary(db: ReturnType<typeof openDatabase>, eventType: string, temporaryMediaId: string, reelId: string, metadata: Record<string, unknown> = {}): void {
  audit(db, { eventId: `section10.3:${eventType}:${temporaryMediaId}`, entityType: "TEMPORARY_MEDIA", entityId: reelId, eventType, actor: "temporary-media-provider", metadata: { temporary_media_id: temporaryMediaId, provider: AZURE_TEMPORARY_MEDIA_PROVIDER, ...metadata } });
}

export class AzureBlobTemporaryMediaProvider implements TemporaryMediaProvider {
  private readonly injectedStorage?: AzureStorageServiceLike;
  private readonly sasGenerator: NonNullable<AzureTemporaryMediaDependencies["sasGenerator"]>;
  private readonly fetcher: TemporaryMediaUrlFetcher;
  private readonly now: () => Date;

  public constructor(private readonly config: MediaConfig, dependencies: AzureTemporaryMediaDependencies = {}) {
    this.injectedStorage = dependencies.storage;
    this.sasGenerator = dependencies.sasGenerator ?? defaultSasGenerator;
    this.fetcher = dependencies.fetcher ?? (async (url) => {
      const response = await fetch(url, { method: "HEAD", redirect: "manual" });
      return { status: response.status, headers: response.headers, redirected: response.redirected };
    });
    this.now = () => safeNow(dependencies);
  }

  private storage(): AzureStorageServiceLike {
    return this.injectedStorage ?? defaultStorage(this.config);
  }

  private validatePreparedUrl(input: { url: string; blobName: string; blobSize: number; expiresAt: string }, expectedHost: string): Promise<TemporaryMediaValidationResult> {
    const parsed = new URL(input.url);
    const base = validateTemporaryMediaUrl(input.url, this.fetcher);
    return base.then((result) => {
      const expires = parsed.searchParams.get("se");
      const permissions = parsed.searchParams.get("sp");
      const expiresAt = expires ?? input.expiresAt;
      if (parsed.hostname !== expectedHost) return { ok: false, code: "AZURE_HOST_REQUIRED", safeUrl: redactSasUrl(input.url), contentType: result.contentType, contentLength: result.contentLength, expectedSize: input.blobSize, expiresAt };
      if (parsed.protocol !== "https:") return { ok: false, code: "HTTPS_REQUIRED", safeUrl: redactSasUrl(input.url), contentType: result.contentType, contentLength: result.contentLength, expectedSize: input.blobSize, expiresAt };
      if (permissions !== "r") return { ok: false, code: "SAS_READ_ONLY_REQUIRED", safeUrl: redactSasUrl(input.url), contentType: result.contentType, contentLength: result.contentLength, expectedSize: input.blobSize, expiresAt };
      if (!expires || Number.isNaN(Date.parse(expires)) || Date.parse(expires) <= this.now().getTime()) return { ok: false, code: "SAS_EXPIRY_INVALID", safeUrl: redactSasUrl(input.url), contentType: result.contentType, contentLength: result.contentLength, expectedSize: input.blobSize, expiresAt };
      if (!result.ok) {
        const code = result.code === "URL_EXPIRED" ? "SAS_EXPIRY_INVALID" : result.code === "DRY_RUN_ONLY" ? "HTTP_ERROR" : result.code;
        return { ok: false, code, safeUrl: redactSasUrl(input.url), contentType: result.contentType, contentLength: result.contentLength, expectedSize: input.blobSize, expiresAt };
      }
      if (result.contentLength === null || result.contentLength <= 0 || result.contentLength !== input.blobSize) return { ok: false, code: "BLOB_SIZE_MISMATCH", safeUrl: redactSasUrl(input.url), contentType: result.contentType, contentLength: result.contentLength, expectedSize: input.blobSize, expiresAt };
      if (!parsed.pathname.endsWith(`/${input.blobName}`)) return { ok: false, code: "AZURE_HOST_REQUIRED", safeUrl: redactSasUrl(input.url), contentType: result.contentType, contentLength: result.contentLength, expectedSize: input.blobSize, expiresAt };
      return { ok: true, code: "PASS", safeUrl: redactSasUrl(input.url), contentType: result.contentType, contentLength: result.contentLength, expectedSize: input.blobSize, expiresAt };
    });
  }

  public async validateTemporaryMedia(result: TemporaryMediaPreparationResult): Promise<TemporaryMediaValidationResult> {
    const { accountName } = validateAzureConfiguration(this.config);
    return this.validatePreparedUrl(result, `${accountName}.blob.${this.config.azureStorageEndpointSuffix}`);
  }

  public async prepareTemporaryMedia(input: TemporaryMediaPreparationInput): Promise<TemporaryMediaPreparationResult> {
    const azure = validateAzureConfiguration(this.config);
    const output = await resolveReviewFile(this.config, input.derivedReelRelativePath);
    const initialStats = await fs.stat(output.absolutePath);
    if (!initialStats.isFile() || initialStats.size <= 0) throw new Error("DERIVED_REEL_FILE_INVALID");
    const beforeChecksum = await sha256File(output.absolutePath);
    if (beforeChecksum !== input.derivedChecksum) throw new Error("SNAPSHOT_INVALIDATED");

    const preparedAt = this.now().toISOString();
    const expiresAt = new Date(this.now().getTime() + azure.ttlMinutes * 60_000).toISOString();
    const temporaryMediaId = `temporary-media-${crypto.createHash("sha256").update(`${input.publicationKey}\n${input.derivedChecksum}`).digest("hex").slice(0, 24)}`;
    const blobName = blobNameFor(input, azure.prefix);
    const db = openDatabase(this.config);
    try {
      const existingRecord = temporaryMediaByIdentity(db, AZURE_TEMPORARY_MEDIA_PROVIDER, input.publicationKey, input.derivedChecksum);
      auditTemporary(db, "TEMP_MEDIA_PREPARE_STARTED", temporaryMediaId, input.reelId, { blob_name: blobName, expected_size: initialStats.size });
      upsertTemporaryMedia(db, { temporary_media_id: temporaryMediaId, reel_id: input.reelId, publication_key: input.publicationKey, provider: AZURE_TEMPORARY_MEDIA_PROVIDER, blob_container: azure.containerName, blob_name: blobName, blob_size: initialStats.size, derived_checksum: input.derivedChecksum, prepared_at: preparedAt, expires_at: expiresAt, status: "PREPARING", cleanup_status: existingRecord?.cleanup_status ?? "NOT_REQUESTED", last_error_safe: null });

      const storage = this.storage();
      const containerProperties = await storage.getContainerProperties(azure.containerName);
      if (containerProperties.publicAccess) throw new Error("AZURE_CONTAINER_MUST_BE_PRIVATE");
      const blob = storage.getBlobClient(azure.containerName, blobName);
      let existing: AzureBlobProperties | null = null;
      try { existing = await blob.getProperties(); } catch (error) { if (!isNotFound(error)) throw error; }
      if (existing && (existing.metadata["derived-checksum"] !== input.derivedChecksum || existing.contentLength !== initialStats.size || existing.contentType !== "video/mp4")) throw new Error("AZURE_BLOB_COLLISION");
      if (!existing) {
        await blob.uploadFile(output.absolutePath, { blobHTTPHeaders: { blobContentType: "video/mp4", blobContentDisposition: "inline" }, metadata: metadataFor(input, preparedAt, expiresAt) });
        auditTemporary(db, "TEMP_MEDIA_UPLOADED", temporaryMediaId, input.reelId, { blob_name: blobName, blob_size: initialStats.size });
      }
      const afterChecksum = await sha256File(output.absolutePath);
      if (afterChecksum !== input.derivedChecksum) throw new Error("SNAPSHOT_INVALIDATED");
      const uploadedProperties = await blob.getProperties();
      if (uploadedProperties.contentLength !== initialStats.size || uploadedProperties.contentType !== "video/mp4" || uploadedProperties.metadata["derived-checksum"] !== input.derivedChecksum) throw new Error("AZURE_BLOB_VALIDATION_FAILED");
      const startsOn = new Date(this.now().getTime() - 5 * 60_000);
      const expiresOn = new Date(this.now().getTime() + azure.ttlMinutes * 60_000);
      const userDelegationKey = await storage.getUserDelegationKey(startsOn, expiresOn);
      const sas = this.sasGenerator({ accountName: azure.accountName, containerName: azure.containerName, blobName, startsOn, expiresOn, userDelegationKey });
      const url = `${blob.url}?${sas}`;
      auditTemporary(db, "TEMP_MEDIA_SAS_CREATED", temporaryMediaId, input.reelId, { blob_name: blobName, expires_at: expiresOn.toISOString(), permissions: "r" });
      const prepared: TemporaryMediaPreparationResult = { ...input, temporaryMediaId, provider: AZURE_TEMPORARY_MEDIA_PROVIDER, containerName: azure.containerName, blobName, blobSize: initialStats.size, preparedAt, expiresAt: expiresOn.toISOString(), state: "SAS_CREATED", cleanupStatus: "NOT_REQUESTED", url, safeUrl: redactSasUrl(url), validation: { ok: false, code: "HTTP_ERROR", safeUrl: redactSasUrl(url), contentType: null, contentLength: null, expectedSize: initialStats.size, expiresAt: expiresOn.toISOString() } };
      const validation = await this.validateTemporaryMedia(prepared);
      if (!validation.ok) {
        upsertTemporaryMedia(db, { temporary_media_id: temporaryMediaId, reel_id: input.reelId, publication_key: input.publicationKey, provider: AZURE_TEMPORARY_MEDIA_PROVIDER, blob_container: azure.containerName, blob_name: blobName, blob_size: initialStats.size, derived_checksum: input.derivedChecksum, prepared_at: preparedAt, expires_at: expiresOn.toISOString(), status: "FAILED", cleanup_status: "PENDING", last_error_safe: validation.code });
        auditTemporary(db, "TEMP_MEDIA_FAILED", temporaryMediaId, input.reelId, { code: validation.code });
        throw new Error(`TEMPORARY_MEDIA_VALIDATION_FAILED:${validation.code}`);
      }
      upsertTemporaryMedia(db, { temporary_media_id: temporaryMediaId, reel_id: input.reelId, publication_key: input.publicationKey, provider: AZURE_TEMPORARY_MEDIA_PROVIDER, blob_container: azure.containerName, blob_name: blobName, blob_size: initialStats.size, derived_checksum: input.derivedChecksum, prepared_at: preparedAt, expires_at: expiresOn.toISOString(), status: "VALIDATED", cleanup_status: "NOT_REQUESTED", last_error_safe: null });
      auditTemporary(db, "TEMP_MEDIA_VALIDATED", temporaryMediaId, input.reelId, { blob_name: blobName, blob_size: initialStats.size, expires_at: expiresOn.toISOString() });
      return { ...prepared, state: "VALIDATED", expiresAt: expiresOn.toISOString(), validation };
    } catch (error) {
      const code = error instanceof Error && error.message.startsWith("TEMPORARY_MEDIA_VALIDATION_FAILED:") ? error.message.slice("TEMPORARY_MEDIA_VALIDATION_FAILED:".length) : safeErrorCode(error);
      try { updateTemporaryMediaStatus(db, temporaryMediaId, "FAILED", "PENDING", code); } catch { /* preserve original failure */ }
      throw error;
    } finally {
      db.close();
    }
  }

  public async getTemporaryPublicUrl(reelId: string): Promise<{ url: string; provider: string; checksumSha256?: string; expiresAt?: string }> {
    const db = openDatabase(this.config);
    let snapshot: { reel_id: string; publication_key: string; derived_reel_relative_path: string; derived_reel_checksum: string; editorial_version: number } | null = null;
    try {
      const row = db.prepare("SELECT snapshot_json FROM pilot_snapshots WHERE reel_id = ? AND status = 'FROZEN' ORDER BY created_at DESC LIMIT 1").get(reelId) as { snapshot_json?: string } | undefined;
      if (!row?.snapshot_json) throw new Error("TEMPORARY_MEDIA_SNAPSHOT_REQUIRED");
      snapshot = JSON.parse(row.snapshot_json) as { reel_id: string; publication_key: string; derived_reel_relative_path: string; derived_reel_checksum: string; editorial_version: number };
    } finally { db.close(); }
    if (!snapshot) throw new Error("TEMPORARY_MEDIA_SNAPSHOT_REQUIRED");
    const prepared = await this.prepareTemporaryMedia({ reelId: snapshot.reel_id, publicationKey: snapshot.publication_key, derivedReelRelativePath: snapshot.derived_reel_relative_path, derivedChecksum: snapshot.derived_reel_checksum, editorialVersion: snapshot.editorial_version });
    return { url: prepared.url, provider: prepared.provider, checksumSha256: prepared.derivedChecksum, expiresAt: prepared.expiresAt };
  }

  public async revokeTemporaryPublicUrl(reelId: string, _url: string): Promise<void> {
    const azure = validateAzureConfiguration(this.config);
    const db = openDatabase(this.config);
    try {
      const row = temporaryMediaByReel(db, reelId);
      if (!row || row.provider !== AZURE_TEMPORARY_MEDIA_PROVIDER) return;
      const blob = this.storage().getBlobClient(azure.containerName, row.blob_name);
      await blob.deleteIfExists();
      updateTemporaryMediaStatus(db, row.temporary_media_id, "CLEANED", "CLEANED");
      auditTemporary(db, "TEMP_MEDIA_CLEANED", row.temporary_media_id, reelId, { blob_name: row.blob_name });
    } finally { db.close(); }
  }

  public async cleanupExpiredMedia(): Promise<number> {
    const azure = validateAzureConfiguration(this.config);
    const db = openDatabase(this.config);
    let cleaned = 0;
    try {
      const rows = expiredTemporaryMedia(db, AZURE_TEMPORARY_MEDIA_PROVIDER, azure.prefix, this.now().toISOString());
      for (const row of rows) {
        updateTemporaryMediaStatus(db, row.temporary_media_id, "EXPIRED", "PENDING");
        auditTemporary(db, "TEMP_MEDIA_EXPIRED", row.temporary_media_id, row.reel_id, { blob_name: row.blob_name });
        await this.storage().getBlobClient(azure.containerName, row.blob_name).deleteIfExists();
        updateTemporaryMediaStatus(db, row.temporary_media_id, "CLEANED", "CLEANED");
        auditTemporary(db, "TEMP_MEDIA_CLEANED", row.temporary_media_id, row.reel_id, { blob_name: row.blob_name });
        cleaned += 1;
      }
      return cleaned;
    } finally { db.close(); }
  }
}
