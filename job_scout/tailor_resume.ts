// Stage 2 helper (fully implemented) + Stage 3 prompt + Claude call (skeleton).
//
// tailorBaseResume() is pure logic: given the base resume and a list of terms
// to emphasize, it scores and reorders content so the most relevant material
// floats to the top and weakly-relevant entries are de-emphasized. The actual
// prose rewrite is done by Claude via the prompt built in buildTailorResumePrompt().

import { readFile } from "node:fs/promises";
import type {
  BaseResume,
  ExperienceEntry,
  ParsedJob,
  ProjectEntry,
  ResumeBullet,
  SkillGroup,
} from "./types.js";

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export async function loadBaseResume(path = "./base_resume.json"): Promise<BaseResume> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as BaseResume;
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s.toLowerCase();
}

/** How many emphasize-terms appear in the given text + tags. */
function relevanceScore(
  text: string,
  tags: string[] | undefined,
  emphasize: string[],
): number {
  const haystack = normalize(text + " " + (tags ?? []).join(" "));
  let score = 0;
  for (const term of emphasize) {
    const t = normalize(term).trim();
    if (!t) continue;
    // Tag match is worth more than a loose substring match.
    if ((tags ?? []).some((tag) => normalize(tag) === t)) score += 2;
    else if (haystack.includes(t)) score += 1;
  }
  return score;
}

/** Stable sort by score descending, preserving original order for ties. */
function sortByScoreDesc<T>(items: T[], scoreOf: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, score: scoreOf(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.item);
}

// ---------------------------------------------------------------------------
// Tailoring (pure)
// ---------------------------------------------------------------------------

export interface TailorOptions {
  /** Skills / projects / keywords to emphasize, from the job description. */
  emphasize: string[];
  /** Drop bullets that score 0 once an entry has more than this many bullets. */
  maxBulletsPerEntry?: number;
  /** Drop projects that score 0 entirely. Default true. */
  dropIrrelevantProjects?: boolean;
}

function tailorBullets(bullets: ResumeBullet[], opts: TailorOptions): ResumeBullet[] {
  const sorted = sortByScoreDesc(bullets, (b) => relevanceScore(b.text, b.tags, opts.emphasize));
  const max = opts.maxBulletsPerEntry ?? Infinity;
  if (sorted.length <= max) return sorted;
  // Keep the top-`max` bullets (already the most relevant after sorting).
  return sorted.slice(0, max);
}

function tailorExperience(
  experience: ExperienceEntry[],
  opts: TailorOptions,
): ExperienceEntry[] {
  const reordered = experience.map((entry) => ({
    ...entry,
    bullets: tailorBullets(entry.bullets, opts),
  }));
  // Keep chronological-ish order but lightly float more relevant roles up:
  // sort by max-bullet relevance, ties keep original (recency) order.
  return sortByScoreDesc(reordered, (entry) =>
    Math.max(0, ...entry.bullets.map((b) => relevanceScore(b.text, [...(entry.tags ?? []), ...(b.tags ?? [])], opts.emphasize))),
  );
}

function tailorProjects(projects: ProjectEntry[], opts: TailorOptions): ProjectEntry[] {
  const scored = projects.map((p) => ({
    project: p,
    score: relevanceScore(p.summary + " " + p.name, p.tags, opts.emphasize),
  }));
  const filtered = (opts.dropIrrelevantProjects ?? true)
    ? scored.filter((s) => s.score > 0 || projects.length <= 1)
    : scored;
  return sortByScoreDesc(filtered, (s) => s.score).map((s) => s.project);
}

function tailorSkills(skills: SkillGroup[], emphasize: string[]): SkillGroup[] {
  // Within each group, float emphasized skills first; reorder groups by hits.
  const groups = skills.map((g) => ({
    ...g,
    skills: sortByScoreDesc(g.skills, (skill) => relevanceScore(skill, [skill], emphasize)),
  }));
  return sortByScoreDesc(groups, (g) =>
    g.skills.reduce((acc, skill) => acc + relevanceScore(skill, [skill], emphasize), 0),
  );
}

/**
 * Returns a NEW resume object with content filtered + reordered for the job.
 * This is deterministic and does no network I/O — easy to unit test.
 */
export function tailorBaseResume(base: BaseResume, opts: TailorOptions): BaseResume {
  return {
    ...base,
    skills: tailorSkills(base.skills, opts.emphasize),
    experience: tailorExperience(base.experience, opts),
    projects: tailorProjects(base.projects, opts),
    // name, headline, summary, contact, education pass through untouched.
  };
}

// ---------------------------------------------------------------------------
// Prompt (Stage 3) — TAILOR_RESUME
// ---------------------------------------------------------------------------

/**
 * Builds the reusable TAILOR_RESUME prompt. The prose template also lives in
 * prompts/tailor_resume.md so you can iterate on it without touching code.
 */
export function buildTailorResumePrompt(job: ParsedJob, tailored: BaseResume): string {
  return `You are tailoring a resume for a specific job. Output ONLY the resume body
in clean Markdown (no preamble, no commentary).

# JOB
Company: ${job.company}
Title: ${job.job_title}
Location: ${job.location}

Job description:
"""
${job.description}
"""

# CANDIDATE (already reordered to emphasize the most relevant material)
${JSON.stringify(tailored, null, 2)}

# INSTRUCTIONS
- Keep the candidate's facts truthful. Never invent experience, employers, dates, or metrics.
- Rewrite the summary (2-3 sentences) so it speaks directly to this role using the posting's language.
- Keep section order as given (it is already prioritized for this job).
- Within each experience entry, lead each bullet with the result/impact. Mirror keywords from the posting where they genuinely apply.
- Minimize or omit content unrelated to this role — do not pad.
- Use this structure: Name + headline, Summary, Skills, Experience, Projects, Education, Certifications.
- Plain Markdown only. No tables. Bullets use "-".`;
}

// ---------------------------------------------------------------------------
// TAILOR_RESUME(job, base) -> tailored_resume_text   (Claude call — SKELETON)
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper matching the spec's signature:
 *   TAILOR_RESUME(job_description, base_resume) -> tailored_resume_text
 *
 * Flow: extract emphasis terms from the JD -> reorder locally -> ask Claude to
 * write the final prose. Wire up the Anthropic SDK call where marked.
 */
export async function TAILOR_RESUME(job: ParsedJob, base: BaseResume): Promise<string> {
  const emphasize = extractEmphasisTerms(job.description);
  const tailored = tailorBaseResume(base, { emphasize, maxBulletsPerEntry: 5 });
  const prompt = buildTailorResumePrompt(job, tailored);

  // The scheduled Claude Code routine writes this prose itself (see
  // ROUTINE_PROMPT.md), so this wrapper only matters for running the scripts
  // standalone. To wire it up then:
  //   const Anthropic = (await import("@anthropic-ai/sdk")).default;
  //   const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  //   const res = await client.messages.create({ model: "claude-opus-4-7",
  //     max_tokens: 2000, messages: [{ role: "user", content: prompt }] });
  //   return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  throw new Error("TAILOR_RESUME runs via the routine; wire the SDK to use standalone. Prompt:\n" + prompt.slice(0, 200) + "...");
}

/**
 * Cheap keyword extraction from a job description. Good enough for v1 — it just
 * needs to surface terms that match your resume tags. Replace with a Claude
 * "parse this JD into {requirements, keywords}" call later if you want richer input.
 */
export function extractEmphasisTerms(description: string): string[] {
  const text = description.toLowerCase();
  // A small, editable vocabulary tuned to Jarrett's background. Multi-word
  // terms work because matching is a substring check. Add/remove as you learn
  // which keywords show up in the jobs you actually target.
  const vocabulary = [
    // Programming & data
    "python", "java", "vba", "excel", "machine learning", "ml", "ai",
    "automation", "control systems", "data analysis", "data", "sql",
    "dashboards", "reporting", "scripting", "proficy",
    // Engineering
    "process optimization", "process engineering", "chemical engineering",
    "process control", "manufacturing", "resource conservation",
    "sustainability", "risk assessment", "pilot", "quality",
    // Professional
    "project management", "leadership", "coordination", "operations",
    "communication", "collaboration", "bilingual", "french",
  ];
  const found = vocabulary.filter((term) => text.includes(term));
  return Array.from(new Set(found));
}
