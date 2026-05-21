// Stage 4 — ingestion + de-duplication. job_id computation and dedup decision
// are fully implemented; the source-readers (Gmail, inbox folder) are wired for
// the local "inbox" pattern and stubbed for Gmail.

import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import type { JobRecord, ParsedJob } from "./types.js";
import type { Tracker } from "./tracker.js";
import { config } from "./config.js";

// ---------------------------------------------------------------------------
// Stable job_id (fully implemented)
// ---------------------------------------------------------------------------

/** Hosts whose URLs are listing aggregators — their URLs are unstable, so we
 *  prefer hashing content rather than trusting the URL as the identity. */
const UNSTABLE_URL_HOSTS = ["lnkd.in", "google.com", "indeed.com/rc/clk"];

function sha16(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/** Strip query/fragment, lowercase host, drop trailing slash. */
export function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    let normalized = `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname}`;
    if (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Compute a stable identifier for a job:
 *  1. If a usable, non-aggregator URL exists -> hash the normalized URL.
 *  2. Otherwise -> hash company + title + first 200 chars of description.
 * Hashing both ways keeps the id a fixed-length, filename-safe string.
 */
export function computeJobId(job: ParsedJob): string {
  const normalized = job.job_url ? normalizeUrl(job.job_url) : null;
  const isUsableUrl =
    normalized && !UNSTABLE_URL_HOSTS.some((h) => normalized.includes(h));

  if (isUsableUrl) return "url_" + sha16(normalized!);

  const company = job.company.trim().toLowerCase();
  const title = job.job_title.trim().toLowerCase();
  const descHead = job.description.replace(/\s+/g, " ").trim().slice(0, 200).toLowerCase();
  return "key_" + sha16(`${company}|${title}|${descHead}`);
}

// ---------------------------------------------------------------------------
// Ingest decision (fully implemented)
// ---------------------------------------------------------------------------

export type IngestResult =
  | { kind: "created"; record: JobRecord }
  | { kind: "duplicate"; job_id: string };

/**
 * The exact steps the routine takes per job:
 *  1. Compute job_id.
 *  2. Look it up in the tracker.
 *  3. If found -> bump last_seen_at, log, skip.
 *  4. If new -> create entry with status "new" + raw description.
 */
export async function ingestJob(job: ParsedJob, tracker: Tracker): Promise<IngestResult> {
  const job_id = computeJobId(job);
  const existing = await tracker.findByJobId(job_id);
  const now = new Date().toISOString();

  if (existing) {
    await tracker.update(job_id, {
      last_seen_at: now,
      notes: appendNote(existing.notes, `duplicate_seen_again_at_${now}`),
    });
    return { kind: "duplicate", job_id };
  }

  const record: JobRecord = {
    job_id,
    company: job.company,
    job_title: job.job_title,
    location: job.location,
    source: job.source,
    status: "new",
    job_url: job.job_url ?? "",
    posted_date: job.posted_date,
    raw_description: job.description,
    first_seen_at: now,
    last_seen_at: now,
    notes: "",
  };
  await tracker.insert(record);
  return { kind: "created", record };
}

function appendNote(existing: string | undefined, note: string): string {
  return existing ? `${existing}\n${note}` : note;
}

// ---------------------------------------------------------------------------
// Source readers
// ---------------------------------------------------------------------------

/**
 * Pattern B (manual paste / drop): read every *.job.json from ./inbox.
 * Fully implemented. After processing, run_daily_job_scout moves the file to
 * inbox/processed/ via markInboxFileProcessed().
 */
export async function readInboxJobs(): Promise<{ job: ParsedJob; file: string }[]> {
  const dir = config.inboxDir;
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: { job: ParsedJob; file: string }[] = [];
  for (const name of entries) {
    if (!name.endsWith(".job.json") || name.startsWith("EXAMPLE")) continue;
    const full = path.join(dir, name);
    const raw = await readFile(full, "utf8");
    const parsed = JSON.parse(raw) as ParsedJob & { _comment?: string };
    delete (parsed as { _comment?: string })._comment;
    out.push({ job: parsed, file: full });
  }
  return out;
}

export async function markInboxFileProcessed(file: string): Promise<void> {
  const processedDir = path.join(config.inboxDir, "processed");
  await mkdir(processedDir, { recursive: true });
  await rename(file, path.join(processedDir, path.basename(file)));
}
