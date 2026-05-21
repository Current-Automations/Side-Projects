// Config for running the scripts STANDALONE (local testing / fallback only).
//
// The real system is the scheduled Claude Code routine (see ROUTINE_PROMPT.md):
// it runs inside Claude Code with the Notion connector, generates the documents
// itself, and reads everything from the repo — so it needs no API keys and does
// not use this file. The few knobs below only matter if you run the .ts scripts
// directly with the local JSON tracker.

import "dotenv/config";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  maxJobsPerRun: num("JOB_SCOUT_MAX_JOBS_PER_RUN", 3),
  // Local-file tracker for standalone runs. The routine writes to Notion instead.
  trackerJsonPath: process.env.TRACKER_JSON_PATH ?? "./tracker.local.json",
  // Folder scanned for manually-dropped job files.
  inboxDir: "./inbox",
};

export type Config = typeof config;
