// Shared types for Job Scout. Naming is intentionally boring and stable —
// these field names line up 1:1 with the tracker columns/properties.

// ---------------------------------------------------------------------------
// Tracker records
// ---------------------------------------------------------------------------

export type JobStatus =
  | "new" // ingested, not yet processed
  | "docs_generated" // resume + cover letter drafted
  | "needs_review" // docs ready, waiting on the human
  | "approved" // human approved; ready to apply
  | "applied" // human submitted the application
  | "rejected" // employer said no / human declined
  | "skipped"; // human chose not to pursue

export type JobSource = "board" | "email" | "manual";

/** A row in the tracker. Optional fields are filled in as the job advances. */
export interface JobRecord {
  job_id: string; // stable identifier (see ingest_jobs.ts)
  company: string;
  job_title: string;
  location: string;
  source: JobSource;
  status: JobStatus;
  job_url: string;
  posted_date?: string; // ISO date, optional
  resume_doc_url?: string;
  cover_letter_doc_url?: string;
  notes?: string;
  // Bookkeeping (not strictly required by the spec, but cheap and useful):
  raw_description?: string; // raw JD text we ingested
  first_seen_at?: string; // ISO timestamp
  last_seen_at?: string; // ISO timestamp (bumped on every duplicate sighting)
}

/** A job as it arrives from a source, before it becomes a tracker row. */
export interface ParsedJob {
  company: string;
  job_title: string;
  location: string;
  description: string; // full job-description text
  source: JobSource;
  job_url?: string; // may be absent for email/manual paste
  posted_date?: string;
}

// ---------------------------------------------------------------------------
// State machine (Stage 6)
// ---------------------------------------------------------------------------

/** Which status a job is allowed to move to from its current status. */
export const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  new: ["docs_generated", "skipped"],
  docs_generated: ["needs_review", "skipped"],
  needs_review: ["approved", "skipped", "rejected"],
  approved: ["applied", "skipped"],
  applied: ["rejected"], // employer can still reject after applying
  rejected: [], // terminal
  skipped: [], // terminal
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return true; // idempotent updates are allowed
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Base resume (Stage 2)
// ---------------------------------------------------------------------------

export interface ResumeBullet {
  text: string;
  // Tags drive tailoring. e.g. ["python", "automation", "leadership"].
  tags?: string[];
}

export interface ExperienceEntry {
  company: string;
  title: string;
  location?: string;
  start: string; // "2021"
  end: string; // "Present"
  bullets: ResumeBullet[];
  tags?: string[]; // entry-level tags, merged with bullet tags when scoring
}

export interface ProjectEntry {
  name: string;
  summary: string;
  url?: string;
  bullets?: ResumeBullet[];
  tags?: string[];
}

export interface EducationEntry {
  school: string;
  credential: string;
  year?: string;
}

export interface CertificationEntry {
  name: string;
  detail?: string;
}

export interface SkillGroup {
  category: string; // "Languages", "Tools", ...
  skills: string[];
}

export interface BaseResume {
  name: string;
  headline: string; // one-line professional headline
  contact: {
    email: string;
    phone?: string;
    location?: string;
    links?: string[]; // portfolio, LinkedIn, GitHub
  };
  summary: string; // 2-3 sentence professional summary
  skills: SkillGroup[];
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  education: EducationEntry[];
  certifications?: CertificationEntry[];
}

// ---------------------------------------------------------------------------
// Story bank (Stage 3 — cover letters)
// ---------------------------------------------------------------------------

export interface Story {
  id: string;
  title: string;
  // The anecdote, kept to a few sentences. Tags let us pick the right one.
  body: string;
  tags?: string[];
}

export interface StoryBank {
  stories: Story[];
}
