import { loadConfig } from "../config/index.js";
import { applyEditorialSuggestion, type AiSuggestionField } from "../ai/apply.js";
import { aiReviewForReel, aiReviewStatus, runAiReview, writeAiReviewReport } from "../ai/engine.js";

function option(args: string[], name: string): string | undefined { return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3); }
function values(args: string[]): string[] { return args.filter((arg) => !arg.startsWith("--")); }
function actor(args: string[], config: ReturnType<typeof loadConfig>): string { return option(args, "by") ?? config.reviewerName ?? ""; }

export async function runAiReviewCommand(command: string | undefined, args: string[]): Promise<boolean> {
  if (!command || !["ai-review:primary", "ai-review:status", "ai-review:reel", "ai-review:report", "ai-review:apply"].includes(command)) return false;
  const config = loadConfig();
  const positional = values(args);
  if (command === "ai-review:primary") {
    const full = args.includes("--full");
    const requestedLimit = option(args, "limit");
    const result = await runAiReview({ mode: full ? "full" : "calibration", ...(requestedLimit ? { limit: Number(requestedLimit) } : full ? {} : { limit: 10 }) }, config);
    console.log(JSON.stringify({ mode: result.mode, provider: result.provider, engine_version: result.engineVersion, candidates: result.candidates, discriminative: result.discriminative, recommendations: Object.fromEntries(result.results.reduce((map, row) => map.set(row.ai_recommendation, (map.get(row.ai_recommendation) ?? 0) + 1), new Map<string, number>())), bible: Object.fromEntries(result.bible.reduce((map, row) => map.set(row.status, (map.get(row.status) ?? 0) + 1), new Map<string, number>())), results: result.results.map((row) => ({ reel_id: row.reel_id, score: row.overall_ai_score, recommendation: row.ai_recommendation, duplicate_risk: row.duplicate_risk, theological_risk: row.theological_risk })) }, null, 2));
    return true;
  }
  if (command === "ai-review:status") { console.log(JSON.stringify(await aiReviewStatus(config), null, 2)); return true; }
  if (command === "ai-review:reel") { if (!positional[0]) throw new Error("USAGE: ai-review:reel <reel-id>"); console.log(JSON.stringify(await aiReviewForReel(positional[0], config), null, 2)); return true; }
  if (command === "ai-review:report") { console.log(JSON.stringify(await writeAiReviewReport(config, args.includes("--sample")), null, 2)); return true; }
  if (command === "ai-review:apply") {
    if (!positional[0]) throw new Error("USAGE: ai-review:apply <reel-id> --fields=selected_hook,caption --by=<operator> --note=<note>");
    const fields = (option(args, "fields") ?? "").split(",").map((value) => value.trim()).filter(Boolean) as AiSuggestionField[];
    const by = actor(args, config); const note = option(args, "note") ?? "Aplicação explícita de sugestão AI.";
    console.log(JSON.stringify(await applyEditorialSuggestion(positional[0], fields, by, note, config), null, 2));
    return true;
  }
  return false;
}
