# CardSnap — Session 2 Handoff

**Commit:** "Session 2: GPT-4o identification endpoint, Zod schemas, scan API route"
**Next:** Session 3 — eBay pricing layer + cache

## What Session 2 produced

### AI layer — `/lib/ai`
- **`identify.ts`** — GPT-4o vision client. `identify(image, { model? })` accepts a base64 string, data URI, or http(s) URL. Preprocesses with `sharp` (EXIF rotate → resize to ≤1024px → JPEG q85 → data URI), calls `chat.completions.create` with `response_format: { type: 'json_object' }`, validates the response against the canonical schema, and retries once with a stricter prompt on malformed output. Returns a discriminated union with codes `INVALID_IMAGE | OPENAI_ERROR | AI_DECLINED | IDENTIFICATION_FAILED`. The OpenAI client is lazily constructed so importing the module never throws when `OPENAI_API_KEY` is absent. Token usage is logged in non-production only.
- **`match.ts`** — maps a `CardIdentification` onto the catalog. Builds a fingerprint, checks `price_cache` first (cache hit short-circuits), then fuzzy-matches the `cards` table. Surfaces `needsConfirmation` when match confidence < 0.6. Bridges the AI/domain field names (`product_line`, `parallel_name`) to the db names (`set_name`, `parallel`) in one place.

### Validation boundary — `lib/types/identification.ts`
Re-exports `CardIdentificationSchema` from `domain.ts` (single source of truth — see decision below) plus `validateIdentification()` and `parseIdentificationJson()`. The parser distinguishes `AI_ERROR` (model declined), `INVALID_JSON`, and `VALIDATION_ERROR`.

### API route — `app/api/scan/route.ts`
`POST /api/scan`. Flow: validate body (Zod) → `checkScanAllowed` (429 if over limit) → `identify()` → **increment quota only after identify succeeds** → `match()` → log to `scan_logs` (SHA-256 image hash only, never the raw image) → return `{ scan_id, card, match, remaining_scans, prices: null }`. Pricing lands in Session 3. Error codes map to `ApiErrorCode` (`VALIDATION_ERROR`, `RATE_LIMIT_EXCEEDED`, `INVALID_IMAGE`, `IDENTIFICATION_FAILED`, `DB_ERROR`).

### Dev test harness — `app/test-scan/`
`page.tsx` (server, redirects to `/` in production) + `test-scan-client.tsx` (client upload form → POST → raw JSON). Dev-only.

### Test infra
Added `vitest` (dev), `vitest.config.ts` (node env, `@` alias), and `test`/`test:watch` scripts. Also installed `openai` and `sharp`.

## Key decisions
- **Single identification schema.** Session 1 already defined `CardIdentificationSchema` in `domain.ts`. Rather than create the playbook's second schema, `identification.ts` re-exports it. Fixed a latent Session 1 bug: `.partial()` cannot be used on a refined Zod v4 object, so the base object was extracted as `CardIdentificationObject` (used by `CorrectionSchema.partial()`) and refined separately into `CardIdentificationSchema`.
- **`json_object` + manual Zod validate**, not OpenAI strict structured outputs — the schema uses `.refine()`/`.default()`, which strict json_schema rejects.

## Test coverage (read this before trusting "it's tested")
- **Covered (TDD, 9 tests):** the pure validation boundary in `identification.ts` — valid/minimal cards, default application, low-confidence acceptance, graded-without-company rejection, AI-error vs invalid-JSON vs validation-error routing.
- **NOT unit-tested:** `identify.ts`, `match.ts`, `route.ts`. These are I/O orchestration (OpenAI, Supabase, HTTP). All-mock tests here would assert against mocks, not behavior. They were intended for manual verification via the test page, but **a live end-to-end scan was NOT run this session** — automated HTTP calls to localhost are blocked in this sandbox (curl blocked, node-fetch unavailable). tsc + eslint + the 9 unit tests all pass.

## Post-build code review — fixes applied
A `code-reviewer` agent reviewed the new files. Fixes landed:
- **`incrementScanCount` now runs after a successful `identify()`** (was before) — a failed/declined scan no longer costs the user a quota slot.
- **`checkScanAllowed` uses `.maybeSingle()` + a "User not found" guard** (was `.single()`, which threw an opaque 500 on an unknown userId).
- Comments corrected on the test page (source still ships, only redirects) and the route's userId stopgap (now references the tracked issue).

## Open items for Session 3
1. **`userId` comes from the request body — stopgap.** Violates "never trust the client"; must come from the authenticated Supabase session before any non-local deploy. Tracked: `.scratch/scan-endpoint/issues/01-scan-userid-from-session.md`.
2. **Dev test page ships in the prod bundle (redirect-only).** Tracked: `.scratch/scan-endpoint/issues/02-test-scan-page-ships-in-prod.md`.
3. **`getActiveTrainingRun()` still NOT wired into `identify.ts`.** Model switching to the active fine-tuned model (with base GPT-4o fallback) is not implemented — `identify` always uses `gpt-4o` unless a caller overrides `options.model`. Carry-over from Session 1.
4. **Migration still not applied to a live Supabase project**, and no live scan has been exercised. Apply `001_initial_schema.sql`, seed a user row, set `OPENAI_API_KEY`, then test `/test-scan` manually with real card images.
5. **`prices` is always `null`** until the Session 3 pricing layer populates it.

## Session 3 goal
eBay pricing layer + 4-hour cache: working price lookup returning avg sold price + last 10 sales with "Prices from eBay" attribution on every scan.
