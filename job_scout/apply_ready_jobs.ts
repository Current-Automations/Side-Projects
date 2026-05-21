// Stage 6 — APPLY_READY_JOBS. Read-only by design: it produces a checklist of
// jobs you've marked "approved" so you can apply by hand. It NEVER submits a
// form and NEVER changes status — you flip "approved" -> "applied" yourself
// after submitting (in the tracker, or via markApplied() below).
//
// Run:  npm run apply-checklist   (i.e. tsx apply_ready_jobs.ts)

import { makeTracker } from "./tracker.js";
import type { JobRecord } from "./types.js";

async function main(): Promise<void> {
  const tracker = makeTracker();
  const approved = await tracker.listByStatus("approved");

  if (approved.length === 0) {
    // eslint-disable-next-line no-console
    console.log('No jobs are "approved" and waiting. Nothing to apply to right now.');
    return;
  }

  // eslint-disable-next-line no-console
  console.log(buildChecklist(approved));
}

export function buildChecklist(jobs: JobRecord[]): string {
  const lines: string[] = [];
  lines.push(`=== Ready to apply (${jobs.length}) ===`);
  lines.push("Submit each one manually, then mark it \"applied\" in the tracker.\n");

  jobs.forEach((job, i) => {
    lines.push(`${i + 1}. [ ] ${job.company} — ${job.job_title}  (${job.location})`);
    if (job.job_url) lines.push(`       Apply at:    ${job.job_url}`);
    if (job.resume_doc_url) lines.push(`       Resume:      ${job.resume_doc_url}`);
    if (job.cover_letter_doc_url) lines.push(`       Cover letter:${job.cover_letter_doc_url}`);
    if (job.notes?.trim()) lines.push(`       Notes:       ${job.notes.replace(/\n/g, "; ")}`);
    lines.push(`       After submitting: set status "applied" (job_id ${job.job_id}).`);
    lines.push("");
  });

  lines.push("Reminder: this tool does not submit anything. You stay in control.");
  return lines.join("\n");
}

/** Optional helper: flip approved -> applied once you've submitted. */
export async function markApplied(job_id: string): Promise<void> {
  const tracker = makeTracker();
  await tracker.update(job_id, { status: "applied", notes: `applied_at_${new Date().toISOString()}` });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("apply_ready_jobs failed:", err);
  process.exitCode = 1;
});
