import { auditEvents, openDatabase } from "../database/db.js";
import { loadConfig } from "../config/index.js";
import { approveEditorial, rejectEditorial, requestEditorialChanges } from "../publishing/approval.js";
import { editEditorialPackage } from "../publishing/editorial-edit.js";
import { evaluateEligibility } from "../publishing/eligibility.js";
import { cancelPublication, publicationJobRow, publicationStatus, runDryRun, schedulePublication } from "../publishing/jobs.js";
import { confirmRights, rejectRights } from "../publishing/rights.js";
import { runSchedulerOnce } from "../publishing/scheduler.js";

function value(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function positionals(args: string[]): string[] {
  return args.filter((arg) => !arg.startsWith("--"));
}

function operator(args: string[]): string {
  const result = value(args, "by");
  if (!result) throw new Error("ACTOR_REQUIRED: use --by=<operator>");
  return result;
}

function note(args: string[]): string {
  return value(args, "note") ?? "Phase 5 operator action";
}

export async function runPublishingCommand(command: string | undefined, args: string[]): Promise<boolean> {
  const values = positionals(args);
  const config = loadConfig();
  switch (command) {
    case "reel:rights": {
      if (values.length < 2) throw new Error("USAGE: reel:rights <reel-id> confirm|reject --by=<operator> --note=<note>");
      const result = values[1] === "confirm" ? confirmRights(values[0], operator(args), note(args), config) : values[1] === "reject" ? rejectRights(values[0], operator(args), note(args), config) : null;
      if (!result) throw new Error("RIGHTS_ACTION_MUST_BE_CONFIRM_OR_REJECT");
      console.log(JSON.stringify(result, null, 2));
      return true;
    }
    case "reel:approve":
      console.log(JSON.stringify(await approveEditorial(values[0], Number(value(args, "version") ?? "1"), operator(args), note(args), config), null, 2));
      return true;
    case "reel:reject":
      console.log(JSON.stringify(await rejectEditorial(values[0], Number(value(args, "version") ?? "1"), operator(args), note(args), config), null, 2));
      return true;
    case "reel:request-changes":
      console.log(JSON.stringify(await requestEditorialChanges(values[0], Number(value(args, "version") ?? "1"), operator(args), note(args), config), null, 2));
      return true;
    case "reel:edit": {
      const changes: Record<string, unknown> = {};
      for (const field of ["caption", "selected_hook", "cta", "cover_text"]) {
        const found = value(args, field);
        if (found !== undefined) changes[field] = found;
      }
      const hashtags = value(args, "hashtags");
      if (hashtags !== undefined) changes.hashtags = hashtags.split(",").map((item) => item.trim()).filter(Boolean);
      console.log(JSON.stringify(await editEditorialPackage(values[0], operator(args), changes, config), null, 2));
      return true;
    }
    case "reel:eligibility":
      console.log(JSON.stringify(await evaluateEligibility(values[0], {}, config), null, 2));
      return true;
    case "reel:schedule":
      console.log(JSON.stringify(await schedulePublication(values[0], values[1], operator(args), config), null, 2));
      return true;
    case "reel:unschedule":
      console.log(JSON.stringify(cancelPublication(values[0], operator(args), config), null, 2));
      return true;
    case "publish:dry-run":
      console.log(JSON.stringify(await runDryRun(values[0], config), null, 2));
      return true;
    case "publish:status":
      console.log(JSON.stringify(publicationStatus(values[0], config), null, 2));
      return true;
    case "scheduler:run-once":
      console.log(JSON.stringify(await runSchedulerOnce(new Date(value(args, "now") ?? new Date().toISOString()), config), null, 2));
      return true;
    case "publish:audit": {
      const db = openDatabase(config);
      try { console.log(JSON.stringify(auditEvents(db, values[0]), null, 2)); } finally { db.close(); }
      return true;
    }
    case "publish:raw-status":
      console.log(JSON.stringify(publicationJobRow(values[0], config), null, 2));
      return true;
    default:
      return false;
  }
}
