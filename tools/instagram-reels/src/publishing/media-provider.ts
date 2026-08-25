import type { TemporaryMediaPreparationInput, TemporaryMediaPreparationResult, TemporaryMediaValidationResult } from "./temporary-media-types.js";

export type { TemporaryMediaPreparationInput, TemporaryMediaPreparationResult, TemporaryMediaValidationResult, TemporaryMediaState, TemporaryMediaProviderName } from "./temporary-media-types.js";

export interface PublicationMediaProvider {
  getTemporaryPublicUrl(reelId: string): Promise<{ url: string; provider: string; checksumSha256?: string; expiresAt?: string }>;
  revokeTemporaryPublicUrl(reelId: string, url: string): Promise<void>;
}

export interface TemporaryMediaProvider extends PublicationMediaProvider {
  prepareTemporaryMedia(input: TemporaryMediaPreparationInput): Promise<TemporaryMediaPreparationResult>;
  validateTemporaryMedia(result: TemporaryMediaPreparationResult): Promise<TemporaryMediaValidationResult>;
  cleanupExpiredMedia(): Promise<number>;
}

/**
 * A dry-run URL is deliberately non-routable. It proves payload construction
 * without exposing a local or OneDrive file to the public internet.
 */
export class DryRunPublicationMediaProvider implements PublicationMediaProvider {
  async getTemporaryPublicUrl(reelId: string): Promise<{ url: string; provider: string }> {
    return { url: `https://dry-run.invalid/vargen-fe/${encodeURIComponent(reelId)}.mp4`, provider: "dry-run" };
  }

  async revokeTemporaryPublicUrl(): Promise<void> {
    return;
  }
}

/**
 * Placeholder for a future time-limited HTTPS provider. It intentionally does
 * not expose local files and fails closed until an approved implementation is
 * configured.
 */
export class BlockedPublicationMediaProvider implements PublicationMediaProvider {
  async getTemporaryPublicUrl(): Promise<{ url: string; provider: string }> {
    throw new Error("PUBLIC_MEDIA_PROVIDER_NOT_CONFIGURED");
  }

  async revokeTemporaryPublicUrl(): Promise<void> {
    return;
  }
}
