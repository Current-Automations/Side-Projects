// Stage 5 — the daily routine. Serial, boring, easy to follow.
//
//   1. Gather candidate jobs from sources (inbox + Gmail).
//   2. Ingest each (compute job_id, dedup) -> new vs duplicate.
//   3. For up to N new jobs: tailor resume, write cover letter, create docs,
//      update tracker to "needs_review" with the doc URLs.
//   4. Print a short human-readable summary.
//
// Run:  npm run scout      (i.e. tsx run_daily_job_scout.ts)
// Schedule this command once per day (see README Stage 7).

import { config } from "./config.js";
import { makeTracker } from "./tracker.js";
import {
  ingestJob,
  markInboxFileProcessed,
  readInboxJobs,
} from "./ingest_jobs.js";
import { loadBaseResume, TAILOR_RESUME, extractEmphasisTerms, tailorBaseResume } from "./tailor_resume.js";
import {
  loadStoryBank,
  summarizeTopAchievements,
  WRITE_COVER_LETTER,
} from "./write_cover_letter.js";
import { createDoc } from "./google_docs.js";
import type { JobRecord, ParsedJob } from "./types.js";

interface RunSummary {
  found: number;
  duplicates: number;
  docsGenerated: number;
  failures: number;
  processed: { company: string; title: string; resumeUrl?: string; coverUrl?: string }[];
}

async function main(): Promise<void> {
  const tracker = makeTracker();
  const base = await loadBaseResume();
  const storyBank = await loadStoryBank();

  // --- 1. Gather candidates -------------------------------------------------
  const inbox = await readInboxJobs();
  const candidates: { job: ParsedJob; file?: string }[] = inbox.map((x) => ({
    job: x.job,
    file: x.file,
  }));

  const summary: RunSummary = {
    found: 0,
    duplicates: 0,
    docsGenerated: 0,
    failures: 0,
    processed: [],
  };

  // --- 2. Ingest (dedup) ----------------------------------------------------
  const newJobs: JobRecord[] = [];
  for (const { job, file } of candidates) {
    const result = await ingestJob(job, tracker);
    if (result.kind === "duplicate") {
      summary.duplicates++;
    } else {
      summary.found++;
      newJobs.push(result.record);
    }
    if (file) await markInboxFileProcessed(file);
  }

  // --- 3. Process up to N new jobs -----------------------------------------
  const toProcess = newJobs.slice(0, config.maxJobsPerRun);
  for (const record of toProcess) {
    try {
      await processJob(record, base, storyBank, tracker, summary);
    } catch (err) {
      summary.failures++;
      await tracker.update(record.job_id, {
        notes: `docs_failed: ${(err as Error).message}`,
      });
    }
  }

  // --- 4. Summary -----------------------------------------------------------
  printSummary(summary, newJobs.length - toProcess.length);
}

async function processJob(
  record: JobRecord,
  base: Awaited<ReturnType<typeof loadBaseResume>>,
  storyBank: Awaited<ReturnType<typeof loadStoryBank>>,
  tracker: ReturnType<typeof makeTracker>,
  summary: RunSummary,
): Promise<void> {
  const job: ParsedJob = {
    company: record.company,
    job_title: record.job_title,
    location: record.location,
    description: record.raw_description ?? "",
    source: record.source,
    job_url: record.job_url,
    posted_date: record.posted_date,
  };

  // Resume.
  const resumeText = await TAILOR_RESUME(job, base);

  // Cover letter (summary derived from the locally-tailored resume).
  const emphasize = extractEmphasisTerms(job.description);
  const tailored = tailorBaseResume(base, { emphasize, maxBulletsPerEntry: 5 });
  const topAchievements = summarizeTopAchievements(tailored);
  const coverText = await WRITE_COVER_LETTER(job, topAchievements, storyBank);

  // Store docs.
  const docTitleBase = `${record.company} - ${record.job_title}`;
  const resumeUrl = await createDoc("resume", `${docTitleBase} Resume`, resumeText);
  const coverUrl = await createDoc("cover_letter", `${docTitleBase} Cover Letter`, coverText);

  // Advance: new -> docs_generated -> needs_review.
  await tracker.update(record.job_id, { status: "docs_generated" });
  await tracker.update(record.job_id, {
    status: "needs_review",
    resume_doc_url: resumeUrl,
    cover_letter_doc_url: coverUrl,
  });

  summary.docsGenerated++;
  summary.processed.push({
    company: record.company,
    title: record.job_title,
    resumeUrl,
    coverUrl,
  });
}

function printSummary(summary: RunSummary, deferred: number): void {
  const lines: string[] = [];
  lines.push("");
  lines.push("=== Job Scout — daily summary ===");
  lines.push(
    `Found ${summary.found} new job(s). Tailored docs generated for ${summary.docsGenerated}. ` +
      `${summary.duplicates} duplicate(s) skipped.` +
      (deferred > 0 ? ` ${deferred} new job(s) deferred to tomorrow (over the daily cap of ${config.maxJobsPerRun}).` : "") +
      (summary.failures > 0 ? ` ${summary.failures} failed (see tracker notes).` : ""),
  );
  for (const p of summary.processed) {
    lines.push(`  • ${p.company} — ${p.title}`);
    if (p.resumeUrl) lines.push(`      resume: ${p.resumeUrl}`);
    if (p.coverUrl) lines.push(`      cover:  ${p.coverUrl}`);
  }
  lines.push(`  Tracker (local standalone runs): ${config.trackerJsonPath}`);
  lines.push("Next: review the docs, then set status to \"approved\" for the ones you want to pursue.");
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Job Scout run failed:", err);
  process.exitCode = 1;
});
