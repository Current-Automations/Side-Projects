# Job Scout

A daily routine that finds a few new jobs matching your criteria, makes sure
they aren't duplicates, and for each new one drafts a **tailored resume**, a
**tailored cover letter**, and a **tracker log entry** — then stops. You stay
human-in-the-loop: nothing is ever submitted automatically.

> Design principle throughout: **simple, serial, boring, robust.** Every piece
> runs locally with zero cloud setup first; you swap in Google/Notion when ready.

---

## TL;DR — what runs

| Command | What it does |
|---|---|
| `npm run scout` | The daily routine. Gathers jobs → dedups → drafts docs for up to N new jobs → logs them as `needs_review`. |
| `npm run apply-checklist` | Prints a manual checklist of jobs you've marked `approved`. Never submits anything. |

Defaults (all configurable in `.env`): **N = 3 jobs/day**, **tracker = Notion**
(or local JSON for testing), **docs = Google Docs** (or local Markdown for testing).

---

## Stage 1 — Tracker schema & storage

### Tracker: **Notion** (chosen)

Notion is the tracker for this build. Its big edge is the **human-in-the-loop
review UX** — a board grouped by status, the resume + cover letter right in the
page body, and one-click status changes are exactly what the daily review loop
needs.

The daily routine reads/writes the database via the **Notion API** using an
integration token (`NOTION_TOKEN`, set as a routine environment variable — see
`ROUTINE_PROMPT.md`). We use the API rather than the managed Notion connector
because the connector's approval gate blocks unattended routine runs; the token
path is deterministic. The `JsonFileTracker` in `tracker.ts` is only a
local-testing convenience for the standalone scripts. The Google Sheets header
row below is kept as an alternative if you ever change your mind.

### Fields (single source of truth — matches `types.ts` `JobRecord`)

| Field | Type | Notes |
|---|---|---|
| `job_id` | string | **Stable id** — see Stage 4. Keep it in column A. |
| `company` | string | |
| `job_title` | string | |
| `location` | string | |
| `source` | enum | `board` \| `email` \| `manual` |
| `status` | enum | `new` \| `docs_generated` \| `needs_review` \| `approved` \| `applied` \| `rejected` \| `skipped` |
| `job_url` | string | |
| `posted_date` | date | optional |
| `resume_doc_url` | string | filled when docs are generated |
| `cover_letter_doc_url` | string | filled when docs are generated |
| `notes` | string | dedup sightings, failures, freeform |
| `raw_description` | string | the JD text we ingested (needed to re-tailor) |
| `first_seen_at` | datetime | bookkeeping |
| `last_seen_at` | datetime | bumped each time a duplicate is seen |

### Notion database template

Create a database named **Job Scout** with these properties:

| Property | Type | Notes |
|---|---|---|
| **Name** | Title | Notion requires one Title. Set it to `Company — Job Title` so cards read nicely. |
| **Job ID** | Text | The stable dedup key (`url_…` / `key_…`). The routine checks this before adding anything. |
| **Company** | Text | |
| **Job Title** | Text | |
| **Location** | Text | |
| **Source** | Select | `board`, `email`, `manual` |
| **Status** | Select | `new`, `docs_generated`, `needs_review`, `approved`, `applied`, `rejected`, `skipped` |
| **Job URL** | URL | |
| **Posted Date** | Date | |
| **Resume Doc** | URL | Link to the Google Doc (optional — the text also goes in the page body). |
| **Cover Letter Doc** | URL | Link to the Google Doc (optional). |
| **Notes** | Text | |
| **Raw Description** | Text | Full JD, so a job can be re-tailored later. |
| **First Seen** | Date | Enable "include time". |
| **Last Seen** | Date | Enable "include time". |

Suggested **Status** colors (nice board UX): new = gray · docs_generated = blue ·
needs_review = yellow · approved = green · applied = purple · rejected = red ·
skipped = brown. The routine writes the tailored resume + cover letter into the
**page body**, so you review everything inside the job's Notion page.

**Views:**
- `Needs Review` — filter `Status = needs_review`, sorted by First Seen ↓ (your daily work queue).
- `Approved` — filter `Status = approved` (the jobs you've green-lit).
- `Pipeline` — Board view grouped by `Status`.
- `All` — table, default.

### Google Sheets header row (fallback option)

If you ever prefer Sheets, put this as **row 1** in a tab named `Jobs` (column
order is significant — the code reads/writes by position):

```
job_id	company	job_title	location	source	status	job_url	posted_date	resume_doc_url	cover_letter_doc_url	notes	raw_description	first_seen_at	last_seen_at
```

Recommended sheet setup: freeze row 1, then create filter views for
`status = needs_review` and `status = approved`.

---

## Stage 2 — Base resume representation

### Choice: **structured JSON** (`base_resume.json`)

Why JSON over a Markdown template: the tailoring step has to **filter and
reorder** bullets, skills, and projects by relevance. With structured data
that's a few lines of deterministic scoring (`tailor_resume.ts`). With free-form
Markdown you'd be parsing prose with regexes — fragile and exactly the
complexity we're avoiding. JSON in, tailored JSON out, then Claude turns it into
polished Markdown prose.

- **`base_resume.json`** — fill in your real content (placeholders are marked with `//`). The `tags` arrays are what tailoring keys off — keep them lowercase and consistent.
- **`tailorBaseResume(base, { emphasize })`** in `tailor_resume.ts` — fully implemented, pure, testable: scores each bullet/skill/project against the emphasis terms, reorders highest-relevance first, and trims weak content. No network calls.
- **`loadBaseResume()`** — reads and parses the file.

---

## Stage 3 — Tailoring prompt templates

Two reusable prompts, available both as standalone files (for pasting into a
Claude Code chat) and as prompt-builders in code:

- **`prompts/tailor_resume.md`** + `buildTailorResumePrompt()` →
  `TAILOR_RESUME(job_description, base_resume) -> tailored_resume_text`
- **`prompts/write_cover_letter.md`** + `buildCoverLetterPrompt()` →
  `WRITE_COVER_LETTER(job_description, tailored_resume_summary, story_bank) -> cover_letter_text`

The cover-letter path auto-selects the most relevant anecdote from
`story_bank.json` by tag overlap (`pickStory()`), and derives the
"top 3–4 achievements" summary from the already-tailored resume
(`summarizeTopAchievements()`).

Both `TAILOR_RESUME()` and `WRITE_COVER_LETTER()` build the full prompt today;
the single remaining step is wiring the Anthropic SDK call (one `messages.create`
— the exact snippet is in `tailor_resume.ts`).

---

## Stage 4 — Job ingestion & de-duplication

### Source patterns

1. **Job-board connectors (`board`)** — what the scheduled routine uses (see
   [`ROUTINE_PROMPT.md`](./ROUTINE_PROMPT.md)): the agent searches Indeed /
   ZipRecruiter each day and fetches full job descriptions. Plain Web Search is
   only a backup, since it returns aggregator listing pages without usable JD text.
2. **Manual drop (`manual`)** — for the standalone scripts / local testing. Drop
   a `*.job.json` file (see `inbox/EXAMPLE.job.json`) into `./inbox`; the script
   ingests it and moves it to `inbox/processed/`.
3. **(Later) Board scraping / APIs** — add a reader that returns `ParsedJob[]`.
   Everything downstream is identical.

### Stable `job_id` (fully implemented in `computeJobId()`)

1. If there's a usable, non-aggregator `job_url` → `url_<sha256-16>` of the
   **normalized** URL (strip query/fragment, lowercase host, drop trailing slash).
2. Otherwise → `key_<sha256-16>` of `company | title | first 200 chars of description`.

Aggregator/redirect hosts (LinkedIn `lnkd.in`, Google, Indeed click-throughs)
are treated as *unstable* and fall through to the content hash, so the same job
seen via two different tracking links still collapses to one id.

### Exact steps per job (`ingestJob()`)

1. Compute `job_id`.
2. Look it up in the tracker.
3. **Found** → bump `last_seen_at`, append `duplicate_seen_again_at_<timestamp>`
   to notes, skip.
4. **Not found** → insert a row with `status = "new"` and the raw description.

---

## Stage 5 — Daily routine

**The real routine is the scheduled Claude Code agent** running
[`ROUTINE_PROMPT.md`](./ROUTINE_PROMPT.md): web-search for jobs → dedup against
Notion → tailor resume + cover letter → write them into the Notion page (and
optionally Google Docs) as `needs_review` → summary. Up to N = 3 new jobs/run;
extras are logged as `new` for a later run.

`run_daily_job_scout.ts` is a **standalone mirror** of the same flow for local
testing (inbox source, JSON tracker, local Markdown docs). Its prose-generation
wrappers throw unless you wire the Anthropic SDK — the scheduled agent doesn't
need that because it *is* Claude.

### Where docs are stored

- **Notion page body** (routine): the tailored resume + cover letter are written
  straight into the job's Notion page, so review happens in one place.
- **Google Docs** (routine, optional): if the Drive/Docs connector is available,
  the routine also saves each as a Google Doc and links it in the page properties.
- **Local Markdown** (standalone scripts): `createDoc()` writes `./output/*.md`.

### Daily summary (example output)

```
=== Job Scout — daily summary ===
Found 3 new job(s). Tailored docs generated for 2. 1 duplicate(s) skipped.
  • Acme Corp — Automation Engineer
      resume: file:///.../output/acme-corp-automation-engineer-resume.resume.md
      cover:  file:///.../output/acme-corp-automation-engineer-cover-letter.cover_letter.md
  • Globex — Integrations Developer
      ...
  Tracker: ./tracker.local.json
Next: review the docs, then set status to "approved" for the ones you want to pursue.
```

---

## Stage 6 — Human-in-the-loop flow

### State machine (enforced in code by `canTransition()`)

```
        ┌─────────────► skipped (terminal)
        │
new ──► docs_generated ──► needs_review ──► approved ──► applied ──► rejected
        │                       │              │
        └──► skipped            ├──► skipped   └──► skipped
                                └──► rejected
```

- `new → docs_generated → needs_review` happens automatically inside the daily run.
- `needs_review → approved` is **your** action (you review, then mark approved).
- `approved → applied` is **your** action after you submit by hand.
- `… → skipped` / `→ rejected` available at the appropriate stages.

Illegal jumps (e.g. `new → applied`) throw — the tracker refuses them.

### Your workflow

1. Open the `Needs Review` view; read each resume + cover-letter doc.
2. Edit the docs directly if you want (they're yours).
3. Set `status = approved` on the ones to pursue (or `skipped`/`rejected`).
4. Run `npm run apply-checklist` to get a submission checklist.

### `APPLY_READY_JOBS` (`apply_ready_jobs.ts`)

Reads `status = approved`, prints a checklist with apply URL, resume link, cover
link, and any notes. **It does not submit forms and does not change status** —
after you apply, you flip `approved → applied` yourself (or call the optional
`markApplied(job_id)` helper).

---

## Scheduled routine

The daily automation runs as a **scheduled Claude Code routine** connected to
this repo. The exact prompt to paste into the routine is in
[`ROUTINE_PROMPT.md`](./ROUTINE_PROMPT.md). Current configured criteria:
**web-search sourcing**, **Process / Chemical Engineering** roles, **GTA / Durham
Region (onsite/hybrid) + remote-in-Canada**. Edit those lines in
`ROUTINE_PROMPT.md` to change what it hunts for.

---

## Stage 7 — Implementation plan for Claude Code

### What lives where

| Part | Form | Why |
|---|---|---|
| The daily run (search → dedup → tailor → log to Notion) | **Scheduled Claude Code routine** (`ROUTINE_PROMPT.md`) | The agent does the work directly via connectors; no servers or keys to babysit. |
| Resume/cover-letter prose generation | **The routine agent itself** | It's already Claude — it writes the prose; no separate API call. |
| Job finding, tracker, doc storage | **Connectors** (Web Search, Notion, optional Google Docs) | Account-level — no API keys in the repo. |
| Resume reorder, job_id, dedup, prompt builders, state machine | **TS helpers** (`prompts/` + this folder) | Deterministic reference logic and the prompt templates the routine follows; also runnable standalone. |

### Directory structure (as built)

```
job_scout/
├── README.md                 ← this file
├── ROUTINE_PROMPT.md         ← prompt to paste into the scheduled daily routine
├── package.json              ← deps + scripts
├── tsconfig.json
├── .env.example              ← copy to .env
├── .gitignore                ← keeps secrets/state out of git
├── config.ts                 ← env-driven config with safe defaults
├── types.ts                  ← JobRecord, BaseResume, state machine
├── base_resume.json          ← YOUR resume (placeholders)
├── story_bank.json           ← YOUR anecdotes (placeholders)
├── tailor_resume.ts          ← resume reorder + prompt builder (standalone helper)
├── write_cover_letter.ts     ← story pick + prompt builder (standalone helper)
├── ingest_jobs.ts            ← job_id + dedup + inbox reader (standalone helper)
├── tracker.ts                ← JsonFileTracker (local-testing tracker)
├── google_docs.ts            ← local Markdown doc writer (standalone helper)
├── run_daily_job_scout.ts    ← standalone test mirror of the routine
├── apply_ready_jobs.ts       ← APPLY_READY_JOBS checklist
├── prompts/
│   ├── tailor_resume.md
│   └── write_cover_letter.md
└── inbox/
    └── EXAMPLE.job.json       ← copy + edit to feed a job manually
```

### What needs what

- **The routine** (the real thing): **no API keys.** It runs inside Claude Code
  with the Notion + Web Search connectors and reads this repo directly.
- **Standalone scripts** (optional, local testing): the pure helpers run now —
  `tailorBaseResume`, `computeJobId`/dedup, `JsonFileTracker`, local Markdown
  docs, the apply checklist, the inbox reader. The two prose wrappers
  (`TAILOR_RESUME` / `WRITE_COVER_LETTER`) throw unless you add the Anthropic SDK,
  because standalone there's no agent to write the prose.

---

## Activate it (minimum real-world steps)

1. **Build the Notion database** with the Stage 1 properties + views.
2. **Notion API token:** create an internal integration
   (notion.so/my-integrations), **share the database with it**, and set its secret
   as the routine env var `NOTION_TOKEN`. Add `api.notion.com` to the routine's
   allowed domains. (Full steps in `ROUTINE_PROMPT.md`.)
3. **Resume + story bank** — already filled in with your real content
   (`base_resume.json`, `story_bank.json`). The routine reads them from the repo each run.
4. **Enable connectors on the scheduled routine:** Indeed and/or ZipRecruiter +
   Web Search (sourcing), Google Drive/Docs (optional, for linked Google Docs).
   (Notion is handled by the token above, not a connector.)
5. **Paste [`ROUTINE_PROMPT.md`](./ROUTINE_PROMPT.md)** into the routine (or point
   the routine at it) and set it to run once per day.
6. **Use the loop.** Each morning: open the `Needs Review` board view → read the
   resume + cover letter in each job's page → set **Status = approved** for the
   ones to pursue → apply by hand → set **Status = applied**.

*(Optional, for local testing only:* `npm install`, then `npm run scout` against
`*.job.json` files in `inbox/`. Pure helpers work as-is; wire the Anthropic SDK
into the two prose wrappers if you want full standalone generation. On
Windows/PowerShell, npm may be blocked — use the node-direct invocation from the
repo root `CLAUDE.md`.*)*
