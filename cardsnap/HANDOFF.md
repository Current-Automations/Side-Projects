# CardSnap — Session 1 Handoff

**Commit:** `255c814` — "Session 1: Supabase schema, typed DB client, active learning pipeline helpers"
**Next:** Session 2 — GPT-4o identification endpoint

## What Session 1 produced

### Database schema — `supabase/migrations/001_initial_schema.sql`
7 tables (not 6 — `corrections` was added as an audit log mapping to training examples):

- `cards` — master catalog. Indexed on `(player_name, year, manufacturer)`. Public read.
- `price_cache` — eBay price cache, 4h TTL. Unique on `card_fingerprint`. Indexed on fingerprint + `expires_at`. Public read.
- `users` — extends `auth.users`. Billing + rate limiting (`plan_tier`, `scans_used_today`, `scans_reset_at`, `timezone`). RLS: own row only.
- `scan_logs` — every scan. Already has Session 2/3 columns: `model_used`, `price_at_scan`, `cache_hit`, `was_corrected`, `correction_source`. RLS: own rows only.
- `corrections` — audit log of user corrections; each row maps to a `training_examples` row. RLS: own rows only.
- `training_examples` — ground truth for fine-tuning. `source` ∈ (`user_correction`, `confirmed`, `bootstrap`), `generation`, `trained_at` (null = unused). Service-role only (RLS blocks all user access).
- `training_runs` — OpenAI fine-tune jobs. `status`, `model_id`, `generation`, `is_active`. Public read so the inference layer can look up the active model.

Functions/triggers:
- `handle_new_user()` trigger — auto-creates a `public.users` row on `auth.users` insert.
- `increment_scan_count(user_id uuid)` — atomic scan-count increment (avoids read-modify-write races). **Param is named `user_id`** to match the JS caller in `rate-limit.ts`.

**Not yet applied to a live Supabase project** — this is a migration file only. Run it in the Supabase SQL editor (or via CLI) before the scan endpoint can write to real tables.

### Typed DB layer — `/lib/db` (import only from `@/lib/db`)
- `client.ts`, `server-client.ts` — Supabase client singletons.
- `cards.ts` — `findCard`, `getCardById`, `insertCard`.
- `price-cache.ts` — `generateFingerprint`, `getCachedPrice`, `setCachedPrice`, `getPreviousAvgPrice`.
- `scan-logs.ts` — `createScanLog`, `markScanCorrected`, `getRecentScans`, `getScanHistory`.
- `scans.ts` — `writeScanResult`, `getScanById` (intended for the Session 2 scan endpoint).
- `users.ts` — `getUserById`, `getUserPlanTier`, `checkScanAllowed`, `incrementScanCount`, `updatePlanTier`, `upsertStripeCustomer`, `upsertUser`.
- `rate-limit.ts` — `getRateLimit`, `decrementRateLimit`, `resetStaleLimits`.
- `corrections.ts` — `insertCorrection`.
- `training.ts` — full pipeline: `insertTrainingExample`, `getUntrainedExamples`, `getActiveTrainingRun`, `createTrainingRun`, `activateTrainingRun`, `pruneOldGenerations`, `markExamplesTrained`, `TRAINING_TRIGGER_THRESHOLD`.
- `schema.ts` — generated `Database` type + row/insert/update types and value unions.

### Types — `/lib/types` (import from `@/lib/types`)
`env.ts` (Zod-validated env), `plans.ts`, `domain.ts`, `api.ts`, `training.ts`, `db.ts`.

### Docs
`PRD.md` and `ISSUES.md` generated at repo root.

## Open items / gotchas for Session 2
1. **No test runner installed.** `package.json` has no `test` script and no vitest/jest. Session 2 is TDD-first — add a runner before writing the identification module tests.
2. **No `openai` dependency** installed yet.
3. **Next.js is v16.2.6, not 14.** Project `AGENTS.md` warns this version has breaking changes vs. training data — read `node_modules/next/dist/docs/` before writing route handlers. Lint script is `eslint`, not `next lint`.
4. **Migration not applied to a live DB** — apply `001_initial_schema.sql` before the endpoint can hit real tables.
5. **No `getActiveTrainingRun` wiring yet** — Session 2 needs to call it at inference time to pick the fine-tuned model, falling back to base GPT-4o.

## Session 2 goal
`/api/scan` route: accept an image, return card identity + confidence. Sequence: OpenAI vision docs (context7) → Zod response schema (TDD) → `/lib/ai/identify.ts` → `/lib/ai/match.ts` → `/app/api/scan/route.ts` → dev-only test page → verify/commit/handoff. Wire model switching via `getActiveTrainingRun()`.
