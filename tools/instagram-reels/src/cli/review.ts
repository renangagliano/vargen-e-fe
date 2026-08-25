import { loadConfig } from "../config/index.js";
import { approveEditorial, rejectEditorial, requestEditorialChanges } from "../publishing/approval.js";
import { editReviewEditorial, listReviewItems, reviewProgress, writePrimaryReviewReport, type ReviewFilters, type ReviewQueue } from "../review/service.js";
import { evaluateContentReadiness } from "../review/readiness.js";
import { saveBibleReferenceDraft, verifyBibleReference } from "../review/bible.js";
import { confirmSourceRights, confirmSourcesFromManifest, rejectSourceRights, rightsSummary, sourceRightsStatus, RIGHTS_CONFIRMATION_STATEMENT } from "../review/rights.js";
import { startReviewCockpit } from "../review/server.js";

function option(args: string[], name: string): string | undefined { return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3); }
function values(args: string[]): string[] { return args.filter((arg) => !arg.startsWith("--")); }
function actor(args: string[], config: ReturnType<typeof loadConfig>): string { return option(args, "by") ?? config.reviewerName ?? ""; }
function note(args: string[]): string { return option(args, "note") ?? "Ação explícita do operador no cockpit local."; }
function requireActor(args: string[], config: ReturnType<typeof loadConfig>): string { const value = actor(args, config); if (!value.trim()) throw new Error("ACTOR_REQUIRED: use --by=<operator> ou VARGEN_REVIEWER_NAME"); return value; }
function queue(args: string[]): ReviewQueue { const value = option(args, "queue"); return value === "secondary" || value === "hold" ? value : "primary"; }
function filters(args: string[]): ReviewFilters { return { collection: option(args, "collection"), qualityTier: option(args, "tier") as ReviewFilters["qualityTier"], reviewStatus: option(args, "review") as ReviewFilters["reviewStatus"], bibleStatus: option(args, "bible"), rightsStatus: option(args, "rights"), contentPillar: option(args, "pillar"), seasonality: option(args, "seasonality"), calendarContext: option(args, "calendar") }; }

export async function runReviewCommand(command: string | undefined, args: string[]): Promise<boolean> {
  if (!command || (!["review:instagram", "review:list", "review:progress", "review:report", "review:approve", "review:reject", "review:needs-changes", "review:readiness", "review:edit", "bible:set", "bible:verify", "rights:status", "rights:confirm-source", "rights:reject-source", "rights:confirm-catalog"].includes(command))) return false;
  const config = loadConfig();
  const positional = values(args);
  switch (command) {
    case "review:instagram": {
      const server = await startReviewCockpit(config, { host: config.reviewHost, port: Number(option(args, "port") ?? config.reviewPort) });
      console.log(`REVIEW_COCKPIT_LISTENING http://${config.reviewHost}:${(server.address() as { port: number }).port}`);
      await new Promise<void>((resolve) => server.once("close", resolve));
      return true;
    }
    case "review:list": {
      const items = await listReviewItems(queue(args), filters(args), config);
      console.log(JSON.stringify(items, null, 2));
      return true;
    }
    case "review:progress":
      console.log(JSON.stringify(await reviewProgress(config), null, 2));
      return true;
    case "review:report":
      console.log(JSON.stringify(await writePrimaryReviewReport(config), null, 2));
      return true;
    case "review:readiness":
      if (!positional[0]) throw new Error("USAGE: review:readiness <reel-id>");
      console.log(JSON.stringify(await evaluateContentReadiness(positional[0], config), null, 2));
      return true;
    case "review:approve":
    case "review:reject":
    case "review:needs-changes": {
      if (!positional[0]) throw new Error("USAGE: review:approve|review:reject|review:needs-changes <reel-id>");
      const version = Number(option(args, "version") ?? "1");
      const by = requireActor(args, config);
      const message = note(args);
      if (command === "review:approve") approveEditorial(positional[0], version, by, message, config);
      else if (command === "review:reject") rejectEditorial(positional[0], version, by, message, config);
      else requestEditorialChanges(positional[0], version, by, message, config);
      console.log(JSON.stringify({ reel_id: positional[0], action: command, version, actor: by }, null, 2));
      return true;
    }
    case "review:edit": {
      if (!positional[0]) throw new Error("USAGE: review:edit <reel-id> --by=<operator> --field=value");
      const changes: Record<string, unknown> = {};
      for (const field of ["editorial_title", "caption", "selected_hook", "cta", "content_pillar", "secondary_pillar", "cover_text", "bible_reference"]) { const value = option(args, field); if (value !== undefined) changes[field] = value; }
      const hashtags = option(args, "hashtags"); if (hashtags !== undefined) changes.hashtags = hashtags.split(",").map((value) => value.trim()).filter(Boolean);
      console.log(JSON.stringify(await editReviewEditorial(positional[0], requireActor(args, config), changes as never, config), null, 2));
      return true;
    }
    case "bible:set": {
      if (positional.length < 2) throw new Error("USAGE: bible:set <reel-id> <reference> --by=<operator> --note=<note> [--verify]");
      console.log(JSON.stringify(await saveBibleReferenceDraft({ reelId: positional[0], reference: positional.slice(1).join(" "), actor: requireActor(args, config), note: note(args), sourceType: "HUMAN_ENTERED", sourceLocation: "operator-cli", verify: args.includes("--verify") }, config), null, 2));
      return true;
    }
    case "bible:verify": {
      if (!positional[0]) throw new Error("USAGE: bible:verify <reel-id> --by=<operator> --note=<note>");
      console.log(JSON.stringify(await verifyBibleReference(positional[0], requireActor(args, config), note(args), config), null, 2));
      return true;
    }
    case "rights:status": {
      console.log(JSON.stringify(positional[0] ? sourceRightsStatus(positional[0], config) : rightsSummary(config), null, 2));
      return true;
    }
    case "rights:confirm-source": {
      if (!positional[0]) throw new Error("USAGE: rights:confirm-source <asset-id> --by=<operator> --note=<note> --confirm=I_CONFIRM_RIGHTS");
      if (option(args, "confirm") !== "I_CONFIRM_RIGHTS") throw new Error("RIGHTS_CONFIRMATION_REQUIRED: use --confirm=I_CONFIRM_RIGHTS");
      console.log(JSON.stringify(confirmSourceRights(positional[0], requireActor(args, config), note(args), RIGHTS_CONFIRMATION_STATEMENT, config), null, 2));
      return true;
    }
    case "rights:reject-source":
      if (!positional[0]) throw new Error("USAGE: rights:reject-source <asset-id> --by=<operator> --note=<note>");
      console.log(JSON.stringify(rejectSourceRights(positional[0], requireActor(args, config), note(args), config), null, 2));
      return true;
    case "rights:confirm-catalog": {
      const manifest = option(args, "manifest") ?? positional[0];
      if (!manifest) throw new Error("USAGE: rights:confirm-catalog --manifest=<path> --by=<operator> --note=<note> --confirm=I_CONFIRM_RIGHTS");
      if (option(args, "confirm") !== "I_CONFIRM_RIGHTS") throw new Error("RIGHTS_CONFIRMATION_REQUIRED: use --confirm=I_CONFIRM_RIGHTS");
      console.log(JSON.stringify(await confirmSourcesFromManifest(manifest, requireActor(args, config), note(args), option(args, "confirm") ?? "", config), null, 2));
      return true;
    }
    default: return false;
  }
}
