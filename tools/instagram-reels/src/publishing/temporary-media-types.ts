export type TemporaryMediaState = "NOT_PREPARED" | "PREPARING" | "UPLOADED_PRIVATE" | "SAS_CREATED" | "VALIDATED" | "EXPIRED" | "REVOKED" | "CLEANED" | "FAILED";

export type TemporaryMediaPreparationInput = {
  reelId: string;
  publicationKey: string;
  derivedReelRelativePath: string;
  derivedChecksum: string;
  editorialVersion: number;
};

export type TemporaryMediaValidationResult = {
  ok: boolean;
  code: "PASS" | "AZURE_HOST_REQUIRED" | "SAS_READ_ONLY_REQUIRED" | "SAS_EXPIRY_INVALID" | "HTTPS_REQUIRED" | "PUBLIC_URL_REQUIRED" | "CONTENT_TYPE_INVALID" | "HTTP_ERROR" | "REDIRECT_NOT_ALLOWED" | "BLOB_SIZE_MISMATCH";
  safeUrl: string;
  contentType: string | null;
  contentLength: number | null;
  expectedSize: number;
  expiresAt: string;
};

export type TemporaryMediaPreparationResult = TemporaryMediaPreparationInput & {
  temporaryMediaId: string;
  provider: "azure-blob-sas";
  containerName: string;
  blobName: string;
  blobSize: number;
  preparedAt: string;
  expiresAt: string;
  state: TemporaryMediaState;
  cleanupStatus: "NOT_REQUESTED" | "PENDING" | "CLEANED";
  url: string;
  safeUrl: string;
  validation: TemporaryMediaValidationResult;
};
