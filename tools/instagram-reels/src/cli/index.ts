import { loadConfig } from "../config/index.js";
import { runDoctor, printDoctor } from "./doctor.js";
import { runScan, printScanSummary } from "./scan.js";
import { inspectCatalog, listCatalog, verifyCatalog } from "./catalog.js";
import { analyzeReelAsset, assetArgument, generateReelPilot, inspectReel, listReelCandidates, validateStoredReel } from "./reels.js";
import { generateEditorialBatchCommand, generateEditorialCommand, requiredArgument, reviewEditorialCommand } from "./editorial.js";
import { runPublishingCommand } from "./publishing.js";
import { runCatalogFactoryCommand } from "./catalog-factory.js";
import { runCurationCommand } from "./curation.js";

function filterArgument(args: string[]): string | undefined {
  const value = args.find((arg) => arg.startsWith("--"));
  return value?.slice(2);
}

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  const config = loadConfig();
  if (await runPublishingCommand(command, args)) return;
  if (await runCatalogFactoryCommand(command, args)) return;
  if (await runCurationCommand(command, args)) return;
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
    case "reel:editorial":
      await generateEditorialCommand(requiredArgument(args));
      return;
    case "reel:editorial-batch":
      await generateEditorialBatchCommand(requiredArgument(args));
      return;
    case "reel:review":
      await reviewEditorialCommand(requiredArgument(args));
      return;
    default:
      console.log("Usage: doctor | scan | list ... | catalog:analyze|catalog:generate|catalog:validate|catalog:editorial [--limit=N] [--collection=C] [--song=S] [--assets=id1,id2] [--resume=false] | catalog:status | catalog:manifest | catalog:storage --assets=N | curation:sample | curation:run | curation:status | curation:manifest | reel:analyze <asset-id> | reel:candidates <asset-id> | reel:generate <asset-id> | reel:inspect <reel-id> | reel:validate <reel-id> | reel:editorial <reel-id> | reel:editorial-batch <asset-id> | reel:review <asset-id> | reel:rights <reel-id> confirm|reject --by=<operator> | reel:approve <reel-id> --version=1 --by=<operator> | reel:eligibility <reel-id> | reel:schedule <reel-id> <datetime> --by=<operator> | publish:dry-run <reel-id> | publish:status <job-id> | scheduler:run-once");
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
