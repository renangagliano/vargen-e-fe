import os from "node:os";
import { loadConfig, type MediaConfig } from "../config/index.js";
import { duePublicationJob, lockPublicationJob, openDatabase } from "../database/db.js";
import { processLockedPublicationJob } from "./jobs.js";

export async function runSchedulerOnce(now = new Date(), config: MediaConfig = loadConfig()): Promise<{ status: "NO_DUE_JOB" | "PROCESSED"; jobId?: string }> {
  const nowIso = now.toISOString();
  const workerId = `${os.hostname()}:${process.pid}`;
  const db = openDatabase(config);
  let jobId: string | undefined;
  try {
    db.exec("BEGIN IMMEDIATE");
    const due = duePublicationJob(db, nowIso);
    if (!due) {
      db.exec("COMMIT");
      return { status: "NO_DUE_JOB" };
    }
    jobId = String(due.publication_job_id);
    const lockUntil = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    lockPublicationJob(db, jobId, workerId, lockUntil);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* rollback is best effort */ }
    throw error;
  } finally { db.close(); }
  if (!jobId) return { status: "NO_DUE_JOB" };
  await processLockedPublicationJob(jobId, workerId, config);
  return { status: "PROCESSED", jobId };
}
