import { loadConfig } from "../config/index.js";
import { applyKnowledgeSuggestion, runKnowledgeAwareEditorial, writeKnowledgeEditorialReport } from "../intelligence/knowledge-editorial.js";

function option(args: string[], name: string): string | undefined { return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3); }

export async function runKnowledgeCommand(command: string | undefined, args: string[]): Promise<boolean> {
  if (!command || !["editorial:knowledge-calibrate", "editorial:knowledge-run", "editorial:knowledge-report", "bible:knowledge-resolve", "editorial:knowledge-apply"].includes(command)) return false;
  const config = loadConfig();
  if (command === "editorial:knowledge-calibrate" || command === "bible:knowledge-resolve") {
    const result = await runKnowledgeAwareEditorial({ mode: "calibration", limit: Number(option(args, "limit") ?? "10") }, config);
    console.log(JSON.stringify({ command, candidates: result.candidates, discriminative: result.discriminative, report: result.reportPaths, bible: (result.report as Record<string, unknown>).bible_classification }, null, 2));
    return true;
  }
  if (command === "editorial:knowledge-run") {
    const result = await runKnowledgeAwareEditorial({ mode: "full" }, config);
    console.log(JSON.stringify({ command, candidates: result.candidates, discriminative: result.discriminative, report: result.reportPaths, queues: (result.report as Record<string, unknown>).queue_distribution }, null, 2));
    return true;
  }
  if (command === "editorial:knowledge-report") {
    console.log(JSON.stringify(await writeKnowledgeEditorialReport(config, !args.includes("--sample")), null, 2));
    return true;
  }
  const reelId = args.find((arg) => !arg.startsWith("--"));
  if (!reelId) throw new Error("REEL_ID_REQUIRED");
  const actor = option(args, "by") ?? config.reviewerName ?? "local-operator";
  const fields = option(args, "fields")?.split(",").map((field) => field.trim()).filter(Boolean);
  const updated = await applyKnowledgeSuggestion(reelId, fields, actor, config);
  console.log(JSON.stringify({ reel_id: reelId, editorial_version: updated.editorial_version, review_status: updated.review_status, applied_by: actor, fields: fields ?? "all" }, null, 2));
  return true;
}
