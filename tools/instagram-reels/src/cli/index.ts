import { loadConfig } from "../config/index.js";
import { runDoctor, printDoctor } from "./doctor.js";
import { runScan, printScanSummary } from "./scan.js";
import { inspectCatalog, listCatalog, verifyCatalog } from "./catalog.js";
import { analyzeReelAsset, assetArgument, generateReelPilot, inspectReel, listReelCandidates, validateStoredReel } from "./reels.js";

function filterArgument(args: string[]): string | undefined {
  const value = args.find((arg) => arg.startsWith("--"));
  return value?.slice(2);
}

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  const config = loadConfig();
  switch (command) {
    case "doctor": {
      const checks = await runDoctor(config);
      printDoctor(checks);
      if (checks.some((check) => check.status === "FAIL")) process.exitCode = 1;
      return;
    }
    case "scan":
      printScanSummary(await runScan(config));
      return;
    case "list":
      await listCatalog(filterArgument(args));
      return;
    case "inspect":
      await inspectCatalog(args.find((arg) => !arg.startsWith("--")));
      return;
    case "verify":
      await verifyCatalog();
      return;
    case "reel:analyze":
      await analyzeReelAsset(assetArgument(args));
      return;
    case "reel:candidates":
      await listReelCandidates(assetArgument(args));
      return;
    case "reel:generate":
      await generateReelPilot(assetArgument(args));
      return;
    case "reel:inspect":
      await inspectReel(assetArgument(args));
      return;
    case "reel:validate":
      await validateStoredReel(assetArgument(args));
      return;
    default:
      console.log("Usage: doctor | scan | list [--matched|--unmatched|--ambiguous|--review_required|--available|--unavailable] | inspect <asset-id> | verify | reel:analyze <asset-id> | reel:candidates <asset-id> | reel:generate <asset-id> | reel:inspect <reel-id> | reel:validate <reel-id>");
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
