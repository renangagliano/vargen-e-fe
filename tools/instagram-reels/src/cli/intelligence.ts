import { loadConfig } from "../config/index.js";
import { writeBiblicalResolutionReport } from "../intelligence/biblical.js";
import { runEditorialCalibration, writeEditorialCalibrationReport } from "../intelligence/calibration.js";
import { writeSourceRegistryReport } from "../intelligence/registry.js";

function option(args: string[], name: string): string | undefined { return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3); }

export async function runIntelligenceCommand(command: string | undefined, args: string[]): Promise<boolean> {
  if (!command || !["biblical:registry", "biblical:resolve", "editorial:calibrate", "editorial:report", "ai-review:phase72"].includes(command)) return false;
  const config = loadConfig();
  if (command === "biblical:registry") { console.log(JSON.stringify(await writeSourceRegistryReport(config), null, 2)); return true; }
  if (command === "biblical:resolve") { console.log(JSON.stringify(await writeBiblicalResolutionReport(config), null, 2)); return true; }
  if (command === "editorial:report") { console.log(JSON.stringify(await writeEditorialCalibrationReport(config, args.includes("--sample")), null, 2)); return true; }
  const full = args.includes("--full");
  const requestedLimit = option(args, "limit");
  const result = await runEditorialCalibration({ mode: full ? "full" : "calibration", ...(requestedLimit ? { limit: Number(requestedLimit) } : {}) }, config);
  const report = await writeEditorialCalibrationReport(config, !full);
  console.log(JSON.stringify({ mode: result.mode, candidates: result.candidates, discriminative: result.discriminative, report, recommendation_distribution: result.report.recommendation_distribution, fast_path: result.report.fast_path, evidence_needed: result.report.evidence_needed, results: result.results.map((row) => ({ reel_id: row.reel_id, song_slug: row.song_slug, overall_score: row.overall_score, editorial_quality_score: row.editorial_quality_score, recommendation: row.recommendation, bible: row.biblical_evidence_status, duplicate_risk: row.duplicate_risk, fast_path: row.fast_path_status, evidence_needed: row.evidence_needed_status })) }, null, 2));
  return true;
}
