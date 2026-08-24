import type { FailureClass, PublicationMode, PublicationPayload } from "../shared/types.js";
import { runtimeEnvironmentValue } from "../config/automation.js";
import { DryRunPublicationMediaProvider, type PublicationMediaProvider } from "./media-provider.js";

export type PublisherResult = {
  status: "PUBLISHED" | "DRY_RUN_VALIDATED" | "BLOCKED_EXTERNAL" | "FAILED";
  remoteContainerId?: string;
  remoteMediaId?: string;
  errorCode?: string;
  errorMessageSafe?: string;
  failureClass?: FailureClass;
};

export type PublisherContext = {
  jobId: string;
  payload: PublicationPayload;
  mode: PublicationMode;
};

export interface SocialPublisher {
  readonly name: string;
  validateConfiguration(): { ok: boolean; reasons: string[] };
  preparePublication(input: { reelId: string; editorialVersion: number; caption: string; coverPath: string; targetAccount: string }): Promise<PublicationPayload>;
  publish(context: PublisherContext): Promise<PublisherResult>;
}

export class DryRunInstagramPublisher implements SocialPublisher {
  readonly name = "dry-run";

  public constructor(private readonly mediaProvider: PublicationMediaProvider = new DryRunPublicationMediaProvider()) {}

  validateConfiguration(): { ok: boolean; reasons: string[] } {
    return { ok: true, reasons: [] };
  }

  async preparePublication(input: { reelId: string; editorialVersion: number; caption: string; coverPath: string; targetAccount: string }): Promise<PublicationPayload> {
    const media = await this.mediaProvider.getTemporaryPublicUrl(input.reelId);
    const publicationKey = `payload-${input.reelId}-${input.editorialVersion}-${input.targetAccount}`;
    return {
      publication_key: publicationKey,
      reel_id: input.reelId,
      editorial_version: input.editorialVersion,
      caption: input.caption,
      video_url: media.url,
      cover_path: input.coverPath,
      target_account: input.targetAccount,
    };
  }

  async publish(context: PublisherContext): Promise<PublisherResult> {
    if (!context.payload.video_url.startsWith("https://dry-run.invalid/")) {
      return { status: "FAILED", errorCode: "DRY_RUN_URL_INVALID", errorMessageSafe: "Dry-run publisher received a non-dry-run URL.", failureClass: "VALIDATION" };
    }
    return { status: "DRY_RUN_VALIDATED" };
  }
}

export type MockPublisherScenario = "success" | "transient-failure" | "permanent-failure" | "rate-limit" | "processing-delay" | "duplicate-attempt";

export class MockInstagramPublisher implements SocialPublisher {
  readonly name = "mock";

  public constructor(private readonly scenario: MockPublisherScenario = "success") {}

  validateConfiguration(): { ok: boolean; reasons: string[] } {
    return { ok: true, reasons: [] };
  }

  async preparePublication(input: { reelId: string; editorialVersion: number; caption: string; coverPath: string; targetAccount: string }): Promise<PublicationPayload> {
    return {
      publication_key: `mock-${input.reelId}-${input.editorialVersion}-${input.targetAccount}`,
      reel_id: input.reelId,
      editorial_version: input.editorialVersion,
      caption: input.caption,
      video_url: "https://mock.invalid/vargen-fe/reel.mp4",
      cover_path: input.coverPath,
      target_account: input.targetAccount,
    };
  }

  async publish(context: PublisherContext): Promise<PublisherResult> {
    switch (this.scenario) {
      case "transient-failure":
        return { status: "FAILED", errorCode: "MOCK_TRANSIENT", errorMessageSafe: "Mock transient failure.", failureClass: "TRANSIENT" };
      case "permanent-failure":
        return { status: "FAILED", errorCode: "MOCK_PERMANENT", errorMessageSafe: "Mock permanent failure.", failureClass: "PERMANENT" };
      case "rate-limit":
        return { status: "FAILED", errorCode: "MOCK_RATE_LIMIT", errorMessageSafe: "Mock rate limit.", failureClass: "RATE_LIMIT" };
      case "processing-delay":
        return { status: "FAILED", errorCode: "MOCK_PROCESSING_DELAY", errorMessageSafe: "Mock remote processing delay.", failureClass: "TRANSIENT" };
      case "duplicate-attempt":
        return { status: "FAILED", errorCode: "DUPLICATE_PUBLICATION", errorMessageSafe: "Mock duplicate attempt blocked.", failureClass: "VALIDATION" };
      default:
        return { status: "PUBLISHED", remoteContainerId: `mock-container-${context.jobId}`, remoteMediaId: `mock-media-${context.jobId}` };
    }
  }
}

export class MetaInstagramPublisher implements SocialPublisher {
  readonly name = "meta-instagram";

  private readonly productionEligible = runtimeEnvironmentValue("META_PRODUCTION_ELIGIBLE")?.toLowerCase() === "true";
  private readonly graphApiVersion = runtimeEnvironmentValue("META_GRAPH_API_VERSION") ?? "";
  private readonly appId = runtimeEnvironmentValue("META_APP_ID") ?? "";
  private readonly accessToken = runtimeEnvironmentValue("INSTAGRAM_ACCESS_TOKEN") ?? "";
  private readonly accountId = runtimeEnvironmentValue("INSTAGRAM_ACCOUNT_ID") ?? "";

  validateConfiguration(): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (!this.productionEligible) reasons.push("META_BUSINESS_VERIFICATION_REQUIRED");
    if (!this.graphApiVersion) reasons.push("META_GRAPH_API_VERSION_MISSING");
    if (!this.appId) reasons.push("META_APP_ID_MISSING");
    if (!this.accountId) reasons.push("INSTAGRAM_ACCOUNT_ID_MISSING");
    if (!this.accessToken) reasons.push("INSTAGRAM_ACCESS_TOKEN_MISSING");
    return { ok: reasons.length === 0, reasons };
  }

  async preparePublication(input: { reelId: string; editorialVersion: number; caption: string; coverPath: string; targetAccount: string }): Promise<PublicationPayload> {
    return {
      publication_key: `meta-${input.reelId}-${input.editorialVersion}-${input.targetAccount}`,
      reel_id: input.reelId,
      editorial_version: input.editorialVersion,
      caption: input.caption,
      video_url: "",
      cover_path: input.coverPath,
      target_account: input.targetAccount,
    };
  }

  async publish(_context: PublisherContext): Promise<PublisherResult> {
    const configuration = this.validateConfiguration();
    if (!configuration.ok) {
      return { status: "BLOCKED_EXTERNAL", errorCode: configuration.reasons[0] ?? "META_NOT_ELIGIBLE", errorMessageSafe: "Official Meta publication is externally blocked or not configured.", failureClass: "EXTERNAL_BLOCKER" };
    }
    return { status: "BLOCKED_EXTERNAL", errorCode: "META_PUBLISHER_REQUIRES_APPROVED_MEDIA_PROVIDER", errorMessageSafe: "A verified temporary HTTPS media provider is required before Meta publication.", failureClass: "EXTERNAL_BLOCKER" };
  }
}
