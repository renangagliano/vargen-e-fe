export type TemporaryMediaState = "NOT_PREPARED" | "PREPARING" | "UPLOADED_PRIVATE" | "SAS_CREATED" | "VALIDATED" | "EXPIRED" | "REVOKED" | "CLEANED" | "FAILED";

export type TemporaryMediaProviderName = "azure-blob-sas" | "onedrive-personal";

export type TemporaryMediaPreparationInput = {
  reelId: string;
  publicationKey: string;
  derivedReelRelativePath: string;
  derivedChecksum: string;
  editorialVersion: number;
};

export type TemporaryMediaValidationResult = {
  ok: boolean;
  code: "PASS" | "AZURE_HOST_REQUIRED" | "SAS_READ_ONLY_REQUIRED" | "SAS_EXPIRY_INVALID" | "HTTPS_REQUIRED" | "PUBLIC_URL_REQUIRED" | "CONTENT_TYPE_INVALID" | "HTTP_ERROR" | "REDIRECT_NOT_ALLOWED" | "BLOB_SIZE_MISMATCH" | "ONEDRIVE_PERSONAL_REQUIRED" | "PERSONAL_ONEDRIVE_IDENTITY_NOT_CONFIRMED" | "ONEDRIVE_ITEM_COLLISION" | "DIRECT_DOWNLOAD_UNAVAILABLE" | "UNTRUSTED_REDIRECT" | "CHECKSUM_MISMATCH" | "CONTENT_LENGTH_MISMATCH" | "LOGIN_PAGE_REJECTED" | "ONEDRIVE_DOWNLOAD_HEAD_UNSUPPORTED" | "ONEDRIVE_DOWNLOAD_HTTP_STATUS" | "ONEDRIVE_DOWNLOAD_REDIRECT_UNTRUSTED" | "ONEDRIVE_DOWNLOAD_HTML_RESPONSE" | "ONEDRIVE_DOWNLOAD_SIZE_MISMATCH" | "ONEDRIVE_DOWNLOAD_CHECKSUM_MISMATCH" | "ONEDRIVE_DOWNLOAD_URL_EXPIRED" | "ONEDRIVE_GRAPH_ITEM_NOT_FOUND" | "ONEDRIVE_DOWNLOAD_NETWORK_ERROR";
  safeUrl: string;
  contentType: string | null;
  contentLength: number | null;
  expectedSize: number;
  expiresAt: string;
  checksumSha256?: string;
  rangeSupport?: "SUPPORTED" | "NOT_SUPPORTED" | "UNKNOWN";
  redirectChain?: string[];
  diagnostics?: {
    initialMethod: "GET";
    initialStatus: number | null;
    redirectStatuses: number[];
    redirectHosts: string[];
    finalStatus: number | null;
    finalHostname: string | null;
    contentType: string | null;
    contentLength: number | null;
    contentRange: string | null;
    acceptRanges: string | null;
    bodyKind: "BINARY" | "HTML" | "JSON" | "EMPTY" | "UNKNOWN";
    authorizationHeaderSent: false;
  };
};

export type TemporaryMediaPreparationResult = TemporaryMediaPreparationInput & {
  temporaryMediaId: string;
  provider: TemporaryMediaProviderName;
  containerName: string;
  blobName: string;
  driveId?: string;
  itemId?: string;
  itemPath?: string;
  blobSize: number;
  preparedAt: string;
  expiresAt: string;
  state: TemporaryMediaState;
  cleanupStatus: "NOT_REQUESTED" | "PENDING" | "CLEANED";
  url: string;
  safeUrl: string;
  validation: TemporaryMediaValidationResult;
};
