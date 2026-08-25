import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, type MediaConfig } from "../config/index.js";
import { runtimeEnvironmentValue } from "../config/automation.js";
import { evaluateContentReadiness } from "../review/readiness.js";
import { BlockedPublicationMediaProvider } from "../publishing/media-provider.js";
import { MetaPilotApi } from "../publishing/meta-pilot-api.js";
import { executeFrozenPilot, freezePilotSnapshot, PILOT_CONFIRMATION, runPilotDryRun, type PilotExecutionResult, type PilotSelection } from "../publishing/pilot.js";

function option(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length) || undefined;
}

async function writeReport(config: MediaConfig, selection: PilotSelection, result?: PilotExecutionResult): Promise<void> {
  if (!config.reelsOutputRoot) return;
  const report = { generated_at: new Date().toISOString(), pilot_candidate: selection.snapshot?.reel_id ?? null, selection_status: selection.status, candidates_considered: selection.candidates_considered, result: result ? { status: result.status, failure_code: result.failure_code ?? null, reel_id: result.snapshot.reel_id, song: result.snapshot.song, collection: result.snapshot.collection, publication_key: result.snapshot.publication_key, governance_gates: result.readiness.gates, container_id: result.container_id, processing_state: result.remote_status, instagram_media_id: result.instagram_media_id, published_at: result.published_at, permalink: result.permalink, media_container_created: result.media_container_created, media_publish_called: result.media_publish_called, content_published: result.content_published, publishing_proven: result.publishing_proven } : null };
  await fs.mkdir(config.reelsOutputRoot, { recursive: true });
  await fs.writeFile(path.join(config.reelsOutputRoot, "instagram-pilot-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const html = `<!doctype html><meta charset="utf-8"><title>Instagram Pilot Report</title><pre>${JSON.stringify(report, null, 2).replace(/[<&>]/g, (value) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[value] ?? value))}</pre>`;
  await fs.writeFile(path.join(config.reelsOutputRoot, "instagram-pilot-report.html"), html, "utf8");
}

function printResult(selection: PilotSelection, result?: PilotExecutionResult): void {
  console.log("Instagram One Reel Pilot");
  console.log("-------------------------");
  console.log(`Pilot Reel: ${selection.snapshot?.reel_id ?? "NONE"}`);
  console.log(`Selection: ${selection.status}`);
  console.log(`Candidates considered: ${selection.candidates_considered}`);
  if (result) {
    console.log(`Song: ${result.snapshot.song}`);
    console.log(`Collection: ${result.snapshot.collection}`);
    console.log(`Technical: ${result.readiness.gates.technical_validation ?? "BLOCKED"}`);
    console.log(`Bible: ${result.readiness.gates.bible_reference_valid ?? "BLOCKED"}`);
    console.log(`Editorial: ${result.readiness.gates.editorial_review ?? "BLOCKED"}`);
    console.log(`Rights: ${result.readiness.gates.rights_status ?? "BLOCKED"}`);
    console.log(`CONTENT_READY: ${result.readiness.status}`);
    console.log(`Temporary media: ${result.media_url?.code ?? "NOT_RUN"}`);
    console.log(`Final status: ${result.status}${result.failure_code ? ` (${result.failure_code})` : ""}`);
    console.log(`Media container created: ${result.media_container_created ? "YES" : "NO"}`);
    console.log(`Media publish called: ${result.media_publish_called ? "YES" : "NO"}`);
    console.log(`Content published: ${result.content_published ? "YES" : "NO"}`);
  }
}

export async function runPilotCommand(command: string | undefined, args: string[], config: MediaConfig = loadConfig()): Promise<boolean> {
  if (command !== "instagram:pilot") return false;
  const dryRun = args.includes("--dry-run");
  const reelId = option(args, "reel");
  const actor = option(args, "by") ?? runtimeEnvironmentValue("VARGEN_REVIEWER_NAME") ?? "operator";
  if (!dryRun && option(args, "confirm") !== PILOT_CONFIRMATION) throw new Error("CONFIRMATION_REQUIRED");
  if (!dryRun && !reelId) throw new Error("EXACTLY_ONE_REEL_REQUIRED");
  if (!dryRun && runtimeEnvironmentValue("INSTAGRAM_PILOT_REAL") !== "true") throw new Error("REAL_PILOT_ENVIRONMENT_REQUIRED");
  if (dryRun) {
    const outcome = await runPilotDryRun(reelId, actor, config);
    await writeReport(config, outcome.selection, outcome.result);
    printResult(outcome.selection, outcome.result);
    return true;
  }
  const snapshot = await freezePilotSnapshot(reelId as string, actor, config);
  const readiness = await evaluateContentReadiness(snapshot.reel_id, config);
  const token = runtimeEnvironmentValue("INSTAGRAM_ACCESS_TOKEN");
  const accountId = runtimeEnvironmentValue("INSTAGRAM_ACCOUNT_ID");
  const version = runtimeEnvironmentValue("META_GRAPH_API_VERSION") ?? "v22.0";
  if (!token || !accountId) throw new Error("INSTAGRAM_API_CONFIGURATION_REQUIRED");
  const api = new MetaPilotApi({ accessToken: token, accountId, graphApiVersion: version });
  const result = await executeFrozenPilot({ config, snapshot, readiness, actor, dryRun: false, api, mediaProvider: new BlockedPublicationMediaProvider() });
  const selection: PilotSelection = { snapshot, status: "SELECTED", candidates_considered: 1 };
  await writeReport(config, selection, result);
  printResult(selection, result);
  if (result.status !== "PUBLISHED") process.exitCode = 1;
  return true;
}
