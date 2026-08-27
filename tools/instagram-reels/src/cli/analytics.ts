import { runtimeEnvironmentValue } from "../config/automation.js";
import type { MediaConfig } from "../config/index.js";
import { collectInstagramAnalytics, OBSERVATION_WINDOWS, type ObservationWindow } from "../analytics/instagram-analytics.js";
import { MetaPilotApi } from "../publishing/meta-pilot-api.js";

function option(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

export async function runInstagramAnalyticsCommand(command: string | undefined, args: string[], config: MediaConfig): Promise<boolean> {
  if (command !== "instagram:analytics") return false;
  const reelId = option(args, "reel");
  if (!reelId) throw new Error("EXACTLY_ONE_REEL_REQUIRED");
  const requestedWindow = option(args, "window") ?? "initial";
  if (!(OBSERVATION_WINDOWS as readonly string[]).includes(requestedWindow)) throw new Error("ANALYTICS_WINDOW_INVALID");
  const token = runtimeEnvironmentValue("INSTAGRAM_ACCESS_TOKEN");
  const accountId = runtimeEnvironmentValue("INSTAGRAM_ACCOUNT_ID");
  const apiVersion = runtimeEnvironmentValue("META_GRAPH_API_VERSION") ?? "v22.0";
  if (!token || !accountId) throw new Error("INSTAGRAM_API_CONFIGURATION_REQUIRED");
  const result = await collectInstagramAnalytics({
    config,
    reelId,
    observationWindow: requestedWindow as ObservationWindow,
    apiVersion,
    api: new MetaPilotApi({ accessToken: token, accountId, graphApiVersion: apiVersion }),
  });
  console.log(`Instagram analytics: ${reelId}`);
  console.log(`Observation window: ${result.snapshot.observation_window}`);
  console.log(`Status: ${result.snapshot.status}`);
  console.log(`Captured at: ${result.snapshot.captured_at}`);
  for (const [metric, value] of Object.entries(result.snapshot.metrics)) console.log(`${metric}: ${value.status}${value.value === undefined ? "" : ` (${value.value})`}`);
  console.log(`Report: ${result.reportPath ?? "NOT_WRITTEN"}`);
  console.log("Meta write operations: NONE");
  return true;
}
