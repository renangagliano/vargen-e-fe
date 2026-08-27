import { generateEditorialBatch, generateEditorialForReel, writeReviewForAsset } from "../editorial/pipeline.js";

function requiredArgument(args: string[]): string {
  const value = args.find((arg) => !arg.startsWith("--"));
  if (!value) throw new Error("USAGE: reel:editorial|reel:editorial-batch|reel:review <id>");
  return value;
}

export async function generateEditorialCommand(reelId: string): Promise<void> {
  console.log(JSON.stringify(await generateEditorialForReel(reelId), null, 2));
}

export async function generateEditorialBatchCommand(assetId: string): Promise<void> {
  const result = await generateEditorialBatch(assetId);
  console.log(JSON.stringify({ manifest_path: result.manifestPath, review_html_path: result.reviewHtmlPath, packages: result.packages }, null, 2));
}

export async function reviewEditorialCommand(assetId: string): Promise<void> {
  console.log(JSON.stringify(await writeReviewForAsset(assetId), null, 2));
}

export { requiredArgument };
