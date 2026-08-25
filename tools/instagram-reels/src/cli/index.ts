import { loadConfig } from "../config/index.js";
import { runDoctor, printDoctor } from "./doctor.js";
import { runScan, printScanSummary } from "./scan.js";
import { inspectCatalog, listCatalog, verifyCatalog } from "./catalog.js";
import { analyzeReelAsset, assetArgument, generateReelPilot, inspectReel, listReelCandidates, validateStoredReel } from "./reels.js";
import { generateEditorialBatchCommand, generateEditorialCommand, requiredArgument, reviewEditorialCommand } from "./editorial.js";
import { runPublishingCommand } from "./publishing.js";
import { runCatalogFactoryCommand } from "./catalog-factory.js";
import { runCurationCommand } from "./curation.js";
import { runReviewCommand } from "./review.js";
import { runAiReviewCommand } from "./ai-review.js";
import { runIntelligenceCommand } from "./intelligence.js";
import { runKnowledgeCommand } from "./knowledge.js";
import { runInstagramConnectivityCommand } from "./connectivity.js";
import { runPilotCommand } from "./pilot.js";
import { runTemporaryMediaCommand } from "./temporary-media.js";

function filterArgument(args: string[]): string | undefined {
  const value = args.find((arg) => arg.startsWith("--"));
  return value?.slice(2);
}

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  const config = loadConfig();
  if (await runInstagramConnectivityCommand(command)) return;
  if (await runTemporaryMediaCommand(command, args, config)) return;
  if (await runPilotCommand(command, args, config)) return;
  if (await runAiReviewCommand(command, args)) return;
  if (await runKnowledgeCommand(command, args)) return;
  if (await runIntelligenceCommand(command, args)) return;
  if (await runReviewCommand(command, args)) return;
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
      console.log("Usage: doctor | scan | list | instagram:connectivity | instagram:pilot --dry-run [--reel=<id>] | instagram:pilot --reel=<id> --confirm=I_CONFIRM_ONE_REEL_PUBLICATION | review:instagram | review:list --queue=primary|secondary|hold | ...");
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
