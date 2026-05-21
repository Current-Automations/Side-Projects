// Tracker abstraction for the STANDALONE scripts. JsonFileTracker is fully
// implemented so the scripts run locally with zero setup. In production the
// scheduled routine uses the Notion connector directly (see ROUTINE_PROMPT.md),
// not this file.

import { readFile, writeFile } from "node:fs/promises";
import { canTransition, type JobRecord, type JobStatus } from "./types.js";
import { config } from "./config.js";

export interface Tracker {
  findByJobId(job_id: string): Promise<JobRecord | undefined>;
  insert(record: JobRecord): Promise<void>;
  update(job_id: string, patch: Partial<JobRecord>): Promise<JobRecord>;
  listByStatus(status: JobStatus): Promise<JobRecord[]>;
  all(): Promise<JobRecord[]>;
}

/** Guards status changes against the Stage 6 state machine. */
function assertValidStatusChange(current: JobRecord, patch: Partial<JobRecord>): void {
  if (patch.status && !canTransition(current.status, patch.status)) {
    throw new Error(
      `Illegal status transition for ${current.job_id}: ${current.status} -> ${patch.status}`,
    );
  }
}

// ---------------------------------------------------------------------------
// JsonFileTracker (fully implemented — default for v1 testing)
// ---------------------------------------------------------------------------

export class JsonFileTracker implements Tracker {
  constructor(private readonly filePath: string = config.trackerJsonPath) {}

  private async read(): Promise<JobRecord[]> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as JobRecord[];
    } catch {
      return [];
    }
  }

  private async write(rows: JobRecord[]): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(rows, null, 2), "utf8");
  }

  async findByJobId(job_id: string): Promise<JobRecord | undefined> {
    return (await this.read()).find((r) => r.job_id === job_id);
  }

  async insert(record: JobRecord): Promise<void> {
    const rows = await this.read();
    if (rows.some((r) => r.job_id === record.job_id)) {
      throw new Error(`Duplicate insert for job_id ${record.job_id}`);
    }
    rows.push(record);
    await this.write(rows);
  }

  async update(job_id: string, patch: Partial<JobRecord>): Promise<JobRecord> {
    const rows = await this.read();
    const idx = rows.findIndex((r) => r.job_id === job_id);
    if (idx === -1) throw new Error(`No record for job_id ${job_id}`);
    assertValidStatusChange(rows[idx], patch);
    rows[idx] = { ...rows[idx], ...patch, job_id }; // job_id is immutable
    await this.write(rows);
    return rows[idx];
  }

  async listByStatus(status: JobStatus): Promise<JobRecord[]> {
    return (await this.read()).filter((r) => r.status === status);
  }

  async all(): Promise<JobRecord[]> {
    return this.read();
  }
}

// ---------------------------------------------------------------------------
// The real tracker is Notion, written by the scheduled routine
// ---------------------------------------------------------------------------
//
// In production the daily routine runs inside Claude Code with the Notion
// connector and reads/writes the database directly (see ROUTINE_PROMPT.md and
// the property list in README Stage 1). There is therefore no API-key-based
// NotionTracker class — the JsonFileTracker above is just for running the
// scripts standalone during local testing.

export function makeTracker(): Tracker {
  return new JsonFileTracker();
}
