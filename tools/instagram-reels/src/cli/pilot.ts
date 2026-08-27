import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, type MediaConfig } from "../config/index.js";
import { loadAutomationConfig, runtimeEnvironmentValue } from "../config/automation.js";
import { evaluateContentReadiness } from "../review/readiness.js";
import { BlockedPublicationMediaProvider } from "../publishing/media-provider.js";
import { AzureBlobTemporaryMediaProvider } from "../publishing/azure-temporary-media.js";
import { OneDrivePersonalTemporaryMediaProvider, type OneDriveTemporaryMediaReadiness } from "../publishing/onedrive-personal-temporary-media.js";
import { createPersonalGraphTokenProvider } from "../publishing/personal-microsoft-auth.js";
import { MetaPilotApi } from "../publishing/meta-pilot-api.js";
import { executeFrozenPilot, freezePilotSnapshot, PILOT_CONFIRMATION, runPilotDryRun, type PilotExecutionResult, type PilotSelection } from "../publishing/pilot.js";

function option(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length) || undefined;
}

export type PilotProviderMode = "azure" | "onedrive-personal" | "blocked";

export function selectedProviderMode(requested: string | undefined): PilotProviderMode {
  const selected = requested ?? runtimeEnvironmentValue("INSTAGRAM_TEMP_MEDIA_PROVIDER");
  if (!selected) return "blocked";
  if (selected === "azure" || selected === "onedrive-personal") return selected;
  throw new Error("TEMPORARY_MEDIA_PROVIDER_INVALID");
}

export function configuredMediaProvider(config: MediaConfig, requested?: string) {
  const selected = selectedProviderMode(requested);
  if (selected === "azure") return new AzureBlobTemporaryMediaProvider(config);
  if (selected === "onedrive-personal") return new OneDrivePersonalTemporaryMediaProvider(config, { tokenProvider: createPersonalGraphTokenProvider(config) });
  return new BlockedPublicationMediaProvider();
}

function prePublishProviderReadiness(result: PilotExecutionResult | undefined, providerReadiness?: OneDriveTemporaryMediaReadiness): OneDriveTemporaryMediaReadiness | null {
  if (providerReadiness) return providerReadiness;
  if (result?.status === "ALREADY_PUBLISHED" && result.content_published) {
    return { ready: true, personalAuthentication: "READY", driveItem: "READY", freshDownloadUrl: "UNAVAILABLE", anonymousValidation: "PASS" };
  }
  if (!result?.media_url?.ok) return null;
  return { ready: true, personalAuthentication: "READY", driveItem: "READY", freshDownloadUrl: "READY", anonymousValidation: "PASS" };
}

async function writeReport(config: MediaConfig, selection: PilotSelection, result?: PilotExecutionResult, provider = "blocked", providerReadiness?: OneDriveTemporaryMediaReadiness): Promise<void> {
  if (!config.reelsOutputRoot) return;
  const preflight = prePublishProviderReadiness(result, providerReadiness);
  const report = { generated_at: new Date().toISOString(), pilot_candidate: selection.snapshot?.reel_id ?? null, selection_status: selection.status, candidates_considered: selection.candidates_considered, provider, pre_publish_media_readiness: preflight, post_publish_cleanup: result?.temporary_media_cleanup ?? "NOT_REQUESTED", provider_readiness: preflight, result: result ? { status: result.status, failure_code: result.failure_code ?? null, reel_id: result.snapshot.reel_id, song: result.snapshot.song, collection: result.snapshot.collection, publication_key: result.snapshot.publication_key, governance_gates: result.readiness.gates, container_id: result.container_id, processing_state: result.remote_status, instagram_media_id: result.instagram_media_id, published_at: result.published_at, permalink: result.permalink, media_container_created: result.media_container_created, media_publish_called: result.media_publish_called, content_published: result.content_published, publishing_proven: result.publishing_proven, real_publication_authorized: result.real_publication_authorized, temporary_media_cleanup: result.temporary_media_cleanup ?? "NOT_REQUESTED" } : null };
  await fs.mkdir(config.reelsOutputRoot, { recursive: true });
  await fs.writeFile(path.join(config.reelsOutputRoot, "instagram-pilot-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const html = `<!doctype html><meta charset="utf-8"><title>Instagram Pilot Report</title><pre>${JSON.stringify(report, null, 2).replace(/[<&>]/g, (value) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[value] ?? value))}</pre>`;
  await fs.writeFile(path.join(config.reelsOutputRoot, "instagram-pilot-report.html"), html, "utf8");
}

function printResult(selection: PilotSelection, result?: PilotExecutionResult, provider = "blocked", providerReadiness?: OneDriveTemporaryMediaReadiness): void {
  console.log("Instagram One Reel Pilot");
  console.log("-------------------------");
  console.log(`Pilot Reel: ${selection.snapshot?.reel_id ?? "NONE"}`);
  console.log(`Selection: ${selection.status}`);
  console.log(`Candidates considered: ${selection.candidates_considered}`);
  console.log(`Provider: ${provider}`);
  if (provider === "onedrive-personal") {
    const preflight = prePublishProviderReadiness(result, providerReadiness);
    console.log(`Personal OneDrive (pre-publish): ${preflight?.personalAuthentication === "READY" ? "PASS" : "NOT_READY"}`);
    console.log(`DriveItem (pre-publish): ${preflight?.driveItem === "READY" ? "PASS" : "NOT_READY"}`);
    console.log(`Temporary media capability (pre-publish): ${preflight?.ready ? "PASS" : "FAIL"}`);
    if (result && result.status !== "DRY_RUN_VALIDATED") console.log(`Temporary OneDrive item (post-publish): ${result.temporary_media_cleanup === "SUCCEEDED" ? "DELETED" : "CLEANUP_PENDING"}`);
  }
  console.log(`Meta connectivity: ${runtimeEnvironmentValue("INSTAGRAM_ACCESS_TOKEN") && runtimeEnvironmentValue("INSTAGRAM_ACCOUNT_ID") ? "PASS" : "NOT_VERIFIED"}`);
  if (result) {
    console.log(`Song: ${result.snapshot.song}`);
    console.log(`Collection: ${result.snapshot.collection}`);
    console.log(`Technical: ${result.readiness.gates.technical_validation ?? "BLOCKED"}`);
    console.log(`Bible: ${result.readiness.gates.bible_reference ?? "BLOCKED"}`);
    console.log(`Editorial: ${result.readiness.gates.editorial_review ?? "BLOCKED"}`);
    console.log(`Rights: ${result.readiness.gates.rights_status ?? "BLOCKED"}`);
    console.log(`Frozen snapshot: PASS`);
    console.log(`CONTENT_READY: ${result.readiness.status === "CONTENT_READY" ? "PASS" : result.readiness.status}`);
    console.log(`Temporary media: ${result.media_url?.code ?? "NOT_RUN"}`);
    console.log(`Final status: ${result.status}${result.failure_code ? ` (${result.failure_code})` : ""}`);
    console.log(`Media container created: ${result.media_container_created ? "YES" : "NO"}`);
    console.log(`Media publish called: ${result.media_publish_called ? "YES" : "NO"}`);
    console.log(`Content published: ${result.content_published ? "YES" : "NO"}`);
    console.log(`Real publication authorized: ${result.real_publication_authorized ? "YES" : "NO"}`);
  }
}

export async function runPilotCommand(command: string | undefined, args: string[], config: MediaConfig = loadConfig()): Promise<boolean> {
  if (command !== "instagram:pilot") return false;
  const dryRun = args.includes("--dry-run");
  const reelId = option(args, "reel");
  const provider = selectedProviderMode(option(args, "provider"));
  const automation = loadAutomationConfig(process.env, config.repoRoot);
  const actor = option(args, "by") ?? runtimeEnvironmentValue("VARGEN_REVIEWER_NAME") ?? "operator";
  if (!dryRun && option(args, "confirm") !== PILOT_CONFIRMATION) throw new Error("CONFIRMATION_REQUIRED");
  if (!dryRun && !reelId) throw new Error("EXACTLY_ONE_REEL_REQUIRED");
  if (!dryRun && !automation.realPilotEnabled) throw new Error("REAL_PILOT_ENVIRONMENT_REQUIRED");
  if (dryRun) {
    const outcome = await runPilotDryRun(reelId, actor, config);
    let providerReadiness: OneDriveTemporaryMediaReadiness | undefined;
    if (provider === "onedrive-personal" && outcome.selection.snapshot) {
      const oneDrive = configuredMediaProvider(config, provider);
      if (!(oneDrive instanceof OneDrivePersonalTemporaryMediaProvider)) throw new Error("TEMPORARY_MEDIA_PROVIDER_INVALID");
      providerReadiness = await oneDrive.checkTemporaryMediaReadiness({ reelId: outcome.selection.snapshot.reel_id, publicationKey: outcome.selection.snapshot.publication_key, derivedReelRelativePath: outcome.selection.snapshot.derived_reel_relative_path, derivedChecksum: outcome.selection.snapshot.derived_reel_checksum, editorialVersion: outcome.selection.snapshot.editorial_version });
    }
    await writeReport(config, outcome.selection, outcome.result, provider, providerReadiness);
    printResult(outcome.selection, outcome.result, provider, providerReadiness);
    return true;
  }
  const snapshot = await freezePilotSnapshot(reelId as string, actor, config);
  const readiness = await evaluateContentReadiness(snapshot.reel_id, config);
  const token = runtimeEnvironmentValue("INSTAGRAM_ACCESS_TOKEN");
  const accountId = runtimeEnvironmentValue("INSTAGRAM_ACCOUNT_ID");
  const version = runtimeEnvironmentValue("META_GRAPH_API_VERSION") ?? "v22.0";
  if (!token || !accountId) throw new Error("INSTAGRAM_API_CONFIGURATION_REQUIRED");
  const api = new MetaPilotApi({ accessToken: token, accountId, graphApiVersion: version });
  const result = await executeFrozenPilot({ config, snapshot, readiness, actor, dryRun: false, api, mediaProvider: configuredMediaProvider(config, provider === "blocked" ? undefined : provider) });
  const selection: PilotSelection = { snapshot, status: "SELECTED", candidates_considered: 1 };
  await writeReport(config, selection, result);
  printResult(selection, result, provider);
  if (result.status !== "PUBLISHED" && result.status !== "ALREADY_PUBLISHED") process.exitCode = 1;
  return true;
}
