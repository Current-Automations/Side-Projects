# CardSnap — Claude Code Playbook
## Complete step-by-step build guide with exact prompts and skill calls

**How to use this file:**
Open it beside your terminal. Every step tells you exactly what to type into Claude Code, which skill or plugin to invoke, and what you should see when it works. Do not skip steps or reorder phases. Each session ends with a commit and a handoff so the next session starts clean.

---

## Before You Touch Claude Code — One-Time Setup

### Step 1: Install the Supabase MCP

Run this in your terminal (outside Claude Code):

```bash
npx @supabase/mcp-server-supabase@latest
```

Then add it to your Claude Code MCP config at `~/.claude/mcp_config.json`:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["@supabase/mcp-server-supabase@latest", "--access-token", "YOUR_SUPABASE_ACCESS_TOKEN"]
    }
  }
}
```

Get your access token from supabase.com → Account → Access Tokens.

### Step 2: Create the project repo

```bash
mkdir cardsnap
cd cardsnap
git init
npx create-next-app@latest . --typescript --tailwind --app --src-dir=false
```

### Step 3: Create CLAUDE.md in the project root

Create this file manually before your first Claude Code session. This is the single most important file in the project — every session reads it first.

```markdown
# CardSnap — Claude Code Context

## What this is
Sports card AI identification and pricing tool.
Chrome extension + Next.js web app.
Users watch live card breaks on Whatnot, TikTok, Instagram.
They press a hotkey, extension screenshots the stream, AI identifies the card,
we return eBay sold price + last 10 sales in under 3 seconds.

## Stack
- Next.js 14 App Router
- TypeScript strict mode
- Supabase (auth + postgres + storage)
- Stripe (subscriptions)
- Vercel (deployment)
- OpenAI API — GPT-4o for vision identification
- eBay Browse API — sold listings for pricing
- shadcn/ui — component base

## TypeScript rules (Matt Pocock enforced)
- Zod for ALL external API response validation — no exceptions
- Never use `any` — use `unknown` and narrow explicitly
- Prefer `satisfies` over `as` for type assertions
- All API routes return typed responses via discriminated unions: { success: true, data: T } | { success: false, error: string }
- Error types are explicit, never raw string throws
- Always validate environment variables with Zod at startup

## Business rules
- Scan rate limiting enforced server-side by plan tier (never trust client)
- Price cache TTL: 4 hours for pricing data, 24 hours for card metadata
- Never store raw stream footage or screenshots — only the scan result
- eBay data must show "Prices from eBay" attribution anywhere displayed
- Free tier: 10 scans/day. Basic $7/mo: 100/day. Pro $15/mo: unlimited. Streamer $29/mo: unlimited + API

## File structure
/app                        Next.js App Router pages and API routes
/app/api/scan               POST — main scan endpoint
/app/api/card/[id]/prices   GET — cached prices for a card
/app/api/scan/correct       POST — user correction submission
/app/api/stripe/webhook     POST — Stripe subscription events
/components                 React components (shadcn/ui base)
/lib                        Shared utilities, API clients, types
/lib/ai                     GPT-4o vision identification logic
/lib/pricing                eBay + 130point pricing layer
/lib/db                     Supabase client and typed query helpers
/lib/types                  Shared TypeScript types and Zod schemas
/extension                  Chrome extension (Manifest V3)
/extension/content          Content scripts — injected into stream pages
/extension/background       Service worker — handles API calls
/extension/popup            Extension popup UI

## Current phase
Phase 0

## Last session summary
[PASTE HANDOFF DOC HERE AT THE START OF EVERY SESSION]
```

### Step 4: Verify hookify is working

Open Claude Code in your project directory and run:

```
/hookify configure
```

When prompted, set up:
- Pre-commit: TypeScript check (`tsc --noEmit`)
- Pre-commit: Lint (`next lint`)

This prevents broken code from ever being committed. Do this before Session 1.

---

## Phase 0 — Bootstrap Training Data (Automated — Replaces Manual Validation)

**REVISED:** Manual validation is replaced by an automated eBay bootstrap scraper + active learning loop.
Launch with base GPT-4o, let users correct mistakes, fine-tune on corrections. Model improves with use.

### Why this is better
- No 3–5 hour manual gate before building
- eBay sold listing titles are rich structured data: `"2023 Panini Prizm #34 LeBron James Silver Holo PSA 10"`
- User corrections during real use are higher-quality training signal than synthetic pre-testing
- Fine-tuning compounds: each generation is better than the last

### Bootstrap data sources (built in Session 1B)
| Source | What you get |
|--------|-------------|
| eBay sold listings | Card images + titles parseable into structured labels |
| TCDB (tradingcarddb.com) | Full checklist: player, year, set, parallel, card number |
| 130point.com | Aggregated eBay sales, semi-structured |
| PSA Population Report | Graded card breakdown by year/set/grade |

### Active learning loop (runs continuously once launched)
```
Stream → Extension captures frame
              ↓
    GPT-4o (or fine-tuned model) identifies card
              ↓
    Result shown to user + confidence score
              ↓
    Wrong? → User corrects → stored in training_examples
    Right? → Optional thumbs-up → stored in training_examples
              ↓
    ~200 new examples accumulated → trigger training run
              ↓
    OpenAI fine-tunes GPT-4o vision → new model_id
              ↓
    Switch active model → fine-tuned version deployed
              ↓
    Generation 3+ training sets → pruned (examples deleted, model deleted from OpenAI)
```

### 3-generation pruning rule
- Generation N (current): keep
- Generation N-1: keep (fallback)
- Generation N-2: keep (safety net)
- Generation N-3 and older: delete training examples + delete fine-tuned model from OpenAI API

### New tables required (added to Session 1 schema)
```sql
-- Ground-truth examples for fine-tuning
training_examples (
  id uuid, image_hash text, correct_labels jsonb,
  source text,  -- 'user_correction' | 'confirmed' | 'bootstrap'
  training_set_id uuid, generation integer, created_at timestamptz
)

-- Tracks each OpenAI fine-tuning job
training_runs (
  id uuid, openai_job_id text, status text,
  model_id text,        -- resulting fine-tuned model ID
  generation integer, example_count integer,
  started_at timestamptz, completed_at timestamptz,
  is_active boolean default false
)
```

### Model switching in inference (added to Session 2)
- Check `training_runs` for the active fine-tuned model at startup
- If active model exists: use it instead of base GPT-4o
- If fine-tuned model errors: fall back to base GPT-4o silently
- Log which model was used on every scan_log record

---

## SESSION 1 — Project Scaffold + Supabase Schema
**Goal:** Repo structure, CLAUDE.md, database schema, typed DB client, git hooks
**Duration:** 2–3 hours
**Plugins active:** Matt Pocock skills, hookify, commit-commands

---

### Step 1.1 — Open Claude Code

```bash
cd cardsnap
claude
```

### Step 1.2 — First prompt of the entire project

Paste this exactly:

```
Read CLAUDE.md.

We are starting Session 1 of the CardSnap build. This is the first session.

Use the `zoom-out` skill to map the full architecture of what we're building before we write any code. I want to see: the system components, how they connect, what the riskiest parts are, and what needs to be built first.

Do not write any files yet.
```

Wait for the full zoom-out output. Read it. If anything looks wrong compared to the product outline, correct it now before proceeding.

### Step 1.3 — Generate the PRD

```
Use the `to-prd` skill to generate a formal Product Requirements Document from the zoom-out output and the context in CLAUDE.md.

Save it as PRD.md in the project root.
```

### Step 1.4 — Break into issues

```
Use the `to-issues` skill on PRD.md to generate a prioritized issue list.

Output as ISSUES.md. Group by phase. Each issue needs: title, acceptance criteria, estimated complexity (S/M/L).
```

### Step 1.5 — Set up git hooks

```
Use the `hookify` skill to configure pre-commit hooks for this project.

Set up:
1. TypeScript check: tsc --noEmit
2. ESLint: next lint
3. No hook for tests yet — we don't have any

Show me the exact hook config before writing it.
```

### Step 1.6 — Supabase schema

```
Use the `context7` skill to pull the latest Supabase JavaScript SDK documentation before we write any database code.

Then create the complete Supabase database schema for CardSnap with these tables:

cards:
- id uuid primary key default gen_random_uuid()
- player_name text not null
- year integer not null
- manufacturer text not null
- set_name text not null
- parallel text default 'Base'
- card_number text
- sport text not null check (sport in ('NFL','NBA','MLB','NHL'))
- created_at timestamptz default now()

price_cache:
- id uuid primary key default gen_random_uuid()
- card_fingerprint text not null unique
- avg_sold_price numeric(10,2)
- last_10_sales jsonb
- grade text
- grade_company text check (grade_company in ('PSA','BGS','SGC','CGC'))
- fetched_at timestamptz default now()
- expires_at timestamptz not null

scan_logs:
- id uuid primary key default gen_random_uuid()
- user_id uuid references auth.users
- card_id uuid references cards(id)
- image_hash text
- ai_response jsonb
- final_card_id uuid references cards(id)
- was_corrected boolean default false
- correction_source text
- created_at timestamptz default now()

users:
- id uuid primary key references auth.users
- stripe_customer_id text unique
- plan_tier text default 'free' check (plan_tier in ('free','basic','pro','streamer'))
- scans_used_today integer default 0
- scans_reset_at timestamptz default now()

Create the migration file at supabase/migrations/001_initial_schema.sql.
Add appropriate indexes: cards(player_name, year, manufacturer), price_cache(card_fingerprint), price_cache(expires_at), scan_logs(user_id), scan_logs(created_at).
Add RLS policies: users can only read/write their own scan_logs and users rows.
```

### Step 1.7 — Typed DB client

```
Now create the typed Supabase client following Matt Pocock TypeScript patterns.

Requirements:
- Use Supabase's generated types (generate the types file from the schema)
- Wrap all DB operations in typed helper functions in /lib/db/
- Every function returns a discriminated union: { success: true, data: T } | { success: false, error: string }
- No raw Supabase client calls outside /lib/db/ — everything goes through these helpers
- Validate all inputs with Zod before they touch the database

Create these helper files:
- /lib/db/client.ts — Supabase client singleton
- /lib/db/cards.ts — card lookup and fuzzy match helpers
- /lib/db/price-cache.ts — cache read/write with TTL check
- /lib/db/scan-logs.ts — log creation and user correction storage
- /lib/db/users.ts — plan tier lookup and scan count management
- /lib/types/db.ts — shared Zod schemas for all DB types
```

### Step 1.8 — Verify everything builds

```
Run tsc --noEmit and next lint. Show me the output. Fix any errors before we commit.
```

### Step 1.9 — Commit

```
Use the `commit-push-pr` skill to commit everything from Session 1.

Commit message: "Session 1: project scaffold, Supabase schema, typed DB client"

Then use the `handoff` skill to generate a session handoff document. Save it as HANDOFF.md. I will paste this into CLAUDE.md at the start of Session 2.
```

---

## SESSION 2 — GPT-4o Identification Endpoint
**Goal:** Working /api/scan endpoint that takes an image and returns card identity with confidence scores
**Duration:** 2–3 hours
**Plugins active:** Matt Pocock skills, codex (boilerplate), context7

---

### Step 2.0 — Session start

Update CLAUDE.md: paste the Session 1 handoff into the "Last session summary" field and update "Current phase" to "Session 2 — GPT-4o identification endpoint".

Then open Claude Code:

```
Read CLAUDE.md. We are on Session 2 of the CardSnap build.

Use `episodic-memory search-conversations` to check if there is any relevant context from previous sessions.

Remind me: what was completed in Session 1 and what are we building today?
```

### Step 2.1 — Pull OpenAI docs

```
Use the `context7` skill to pull the latest OpenAI vision API documentation, specifically for GPT-4o image inputs and the chat completions endpoint.

I need to know: correct way to pass base64 images, token costs for vision, rate limits, and any changes since your training data.
```

### Step 2.2 — Zod schemas for AI response

```
Use `tdd` skill to build the identification module test-first.

First, create the Zod schema for the GPT-4o response at /lib/types/identification.ts:

The AI returns JSON with these fields:
- player_name: string
- year: number
- manufacturer: string (enum: Panini, Topps, Upper Deck, Leaf, Donruss)
- set_name: string
- parallel: string
- card_number: string optional
- serial_number: string optional (format: "/25", "1/1", etc.)
- is_graded: boolean
- grade_company: string optional enum (PSA, BGS, SGC, CGC)
- grade_value: string optional (e.g. "9", "9.5", "10")
- sport: string enum (NFL, NBA, MLB, NHL)
- confidence: number between 0 and 1
- error: string optional

Write the Zod schema, then write tests for it in /lib/ai/__tests__/identification.test.ts covering:
- Valid complete response
- Valid response with missing optional fields
- Response with error field
- Response with confidence below 0.5
- Malformed JSON handling
```

### Step 2.3 — GPT-4o client

```
Now build the GPT-4o vision client at /lib/ai/identify.ts.

Requirements:
- Accepts base64 image string or image URL
- Preprocesses image: resize to max 1024px longest side, convert to jpeg if not already
- Calls GPT-4o with the identification prompt from CLAUDE.md
- Validates response against the Zod schema from Step 2.2
- If validation fails, retries once with a more explicit prompt
- Returns discriminated union: { success: true, data: IdentificationResult } | { success: false, error: string, raw?: unknown }
- Logs token usage to console in development
- Environment variable: OPENAI_API_KEY validated with Zod at module load

The system prompt to use:
"""
You are a sports card identification expert with encyclopedic knowledge of NFL, NBA, MLB, and NHL trading cards from 1980 to present. You can identify cards from partial images and distinguish parallels, variations, and serial-numbered editions. You always return valid JSON and never guess — if uncertain, lower the confidence score.
"""

The user prompt to use:
"""
Analyze this sports card image and return a JSON object with these exact fields: player_name, year, manufacturer, set_name, parallel, card_number (optional), serial_number (optional), is_graded, grade_company (optional), grade_value (optional), sport, confidence (0-1).

If this is not a sports card or the image is too blurry to identify, return: {"error": "reason"}

Return ONLY the JSON object. No explanation, no markdown, no backticks.
"""
```

### Step 2.4 — Card fuzzy matching

```
Build the card database matching layer at /lib/ai/match.ts.

This takes an IdentificationResult from GPT-4o and finds the best matching card in our Supabase cards table.

Requirements:
- Normalize all strings before comparison: lowercase, trim, remove special chars
- Build a fingerprint from: player_name + year + manufacturer + set_name + parallel
- Check price_cache first using the fingerprint (cache hit = skip DB lookup)
- If no cache hit: query cards table with fuzzy match on player_name + year + manufacturer
- Return top match with a match_confidence score
- If match_confidence below 0.6: return { needsConfirmation: true } flag so frontend can ask user
- Log all cache hits and misses for monitoring
```

### Step 2.5 — The scan API route

```
Now build the main API route at /app/api/scan/route.ts.

Full flow:
1. Parse and validate incoming request body with Zod: { image: string (base64 or URL), userId: string }
2. Check user plan tier and scan count — reject with 429 if over limit
3. Increment scan count for user
4. Call identify() from /lib/ai/identify.ts
5. Call match() from /lib/ai/match.ts
6. Log to scan_logs table
7. Return: { card: IdentificationResult, match: CardMatch, prices: null (populated in Session 3) }

Rate limit enforcement:
- Free: 10/day
- Basic: 100/day
- Pro + Streamer: unlimited (return immediately without count check)

All errors return: { success: false, error: string, code: string }
Error codes: RATE_LIMITED, INVALID_IMAGE, IDENTIFICATION_FAILED, DB_ERROR
```

### Step 2.6 — Test the endpoint manually

```
Use the `prototype` skill to create a simple test page at /app/test-scan/page.tsx that:
- Has a file upload input for an image
- Calls POST /api/scan with the image as base64
- Displays the raw JSON response

This is a dev-only page, not for production. Add a check: if (process.env.NODE_ENV === 'production') redirect to /.

I want to test the endpoint with real card images before we build the pricing layer.
```

### Step 2.7 — Verify, commit, handoff

```
Run tsc --noEmit and next lint. Run the test suite with npm test. Show me all output.

Fix any failures. Then use `verification-before-completion` skill to check:
- Does the identification endpoint handle malformed images gracefully?
- Does rate limiting actually enforce per user?
- Are all external responses validated with Zod?
- Is there any `any` type in the new files?

Then use `commit-push-pr` skill: "Session 2: GPT-4o identification endpoint, Zod schemas, scan API route"

Then use `handoff` skill. Save as HANDOFF.md.
```

---

## SESSION 3 — eBay Pricing Layer + Cache
**Goal:** Working price lookup, 4-hour cache, last 10 sales returned with every scan
**Duration:** 2–3 hours
**Plugins active:** Matt Pocock skills, codex, context7, security-guidance

---

### Step 3.0 — Session start

Update CLAUDE.md with Session 2 handoff. Then:

```
Read CLAUDE.md. Session 3. Goal: eBay pricing layer and cache.

Use `context7` to pull the latest eBay Browse API documentation. I specifically need:
- How to search completed/sold listings
- The correct endpoint and parameters for sports card category (212)
- Authentication: OAuth vs App ID for read-only browsing
- Rate limits and caching requirements from eBay's terms
```

### Step 3.1 — Security check on eBay integration

```
Use the `security-guidance` skill before we build the eBay client.

I'm integrating eBay's Browse API to pull sold listing prices. Key questions:
- Where should the eBay App ID and cert ID be stored?
- Is it safe to cache eBay responses? For how long per their terms?
- What should I do if eBay returns 0 results vs an error?
- Any other security concerns with this integration?
```

### Step 3.2 — eBay client with Zod

```
Use `tdd` skill. Build the eBay pricing client test-first.

First write the Zod schema at /lib/types/pricing.ts for eBay API responses:
- Individual sale: { price: number, currency: string, date: string, title: string, condition: string optional, grade: string optional }
- Pricing result: { avg_price: number, last_10_sales: Sale[], sample_size: number, fetched_at: string }

Then write tests at /lib/pricing/__tests__/ebay.test.ts covering:
- Successful response with 10+ sales
- Response with fewer than 10 sales
- Empty results (no sales found)
- API error handling
- Query construction for different card types (base, parallel, graded)

Then build /lib/pricing/ebay.ts:
- buildQuery(card: IdentificationResult): string — constructs the eBay search query
  Format: "{player_name}" "{year}" "{set_name}" "{parallel}" card
  If graded: append "PSA 9" or equivalent
  Never include serial number in query — too specific, returns zero results
- searchSoldListings(query: string): Promise<PricingResult>
  Call eBay Browse API, category 212, completed listings only
  Parse prices, extract grade from title if present
  Calculate average from top 10 most recent
  Return PricingResult or throw typed error
- Environment: EBAY_APP_ID validated with Zod at module load
```

### Step 3.3 — Cache layer

```
Build the cache layer at /lib/pricing/cache.ts.

Logic:
- generateFingerprint(card: IdentificationResult): string
  Hash of: player_name.toLowerCase() + year + manufacturer.toLowerCase() + set_name.toLowerCase() + parallel.toLowerCase() + (grade_company ?? '') + (grade_value ?? '')
  Use Node's crypto.createHash('sha256') — no external library needed

- getCachedPrice(fingerprint: string): Promise<PricingResult | null>
  Check price_cache table, only return if expires_at > now()
  Return null on cache miss or expired

- setCachedPrice(fingerprint: string, data: PricingResult): Promise<void>
  Write to price_cache with expires_at = now() + 4 hours
  Upsert on fingerprint conflict

- getPriceWithCache(card: IdentificationResult): Promise<PricingResult>
  1. Generate fingerprint
  2. Check cache → return if hit
  3. Call eBay API if miss
  4. Write to cache
  5. Return result
```

### Step 3.4 — Wire pricing into the scan endpoint

```
Update /app/api/scan/route.ts to include pricing data.

After identification and matching:
- Call getPriceWithCache(identificationResult)
- Add to the scan_logs record: price at time of scan, whether it was a cache hit
- Return in response: { card, match, prices: PricingResult, cache_hit: boolean }

Also add a price trend indicator to the response:
- Compare avg_price to the previous cached avg for the same fingerprint
- Return: trend: 'up' | 'down' | 'stable' | 'new'
- 'new' means no previous data to compare
```

### Step 3.5 — The correction endpoint

```
Build /app/api/scan/correct/route.ts.

Accepts: { scan_log_id: string, corrected_card: Partial<IdentificationResult> }

Flow:
1. Validate request with Zod
2. Verify scan_log_id belongs to the requesting user
3. Update scan_logs: set was_corrected = true, correction_source = 'user'
4. Generate new fingerprint from corrected card data
5. Re-fetch prices using corrected fingerprint
6. Return updated pricing result

This endpoint is important for the improvement loop — every correction is training data.
```

### Step 3.6 — Verify, commit, handoff

```
Run full test suite. Use `verification-before-completion` skill:
- Does the cache correctly expire after 4 hours?
- Does the eBay query builder handle graded cards differently from raw?
- Are eBay credentials never exposed in API responses?
- Does the correction endpoint verify ownership before allowing correction?

Fix anything flagged. Then:
`commit-push-pr` skill: "Session 3: eBay pricing layer, fingerprint cache, correction endpoint"
`handoff` skill → save as HANDOFF.md
```

---

## SESSION 4 — Stripe Subscription + Auth
**Goal:** Supabase Auth, Stripe subscription gating, all four plan tiers enforced
**Duration:** 2 hours
**Plugins active:** Matt Pocock skills, Stripe MCP, security-guidance

---

### Step 4.0 — Session start

Update CLAUDE.md with Session 3 handoff. Then:

```
Read CLAUDE.md. Session 4. Goal: auth and subscription gating.

You have the Stripe MCP connected. Use it to:
1. List my existing products
2. List my existing prices

I may already have some Stripe products from my other project (Current Automations). I need to create NEW products specifically for CardSnap. Show me what exists first so we don't duplicate.
```

### Step 4.1 — Create Stripe products

After reviewing existing products:

```
Using the Stripe MCP, create the CardSnap subscription products:

Product 1: CardSnap Basic
- Price: $7.00/month recurring
- Metadata: plan_tier=basic, scans_per_day=100

Product 2: CardSnap Pro
- Price: $15.00/month recurring
- Metadata: plan_tier=pro, scans_per_day=unlimited

Product 3: CardSnap Streamer
- Price: $29.00/month recurring
- Metadata: plan_tier=streamer, scans_per_day=unlimited, api_access=true

Show me the price IDs after creation. Save them — I'll need them for the pricing page.
```

### Step 4.2 — Supabase Auth setup

```
Use `context7` to pull the latest Supabase Auth documentation for Next.js App Router.

Then set up Supabase Auth in the project:
- Install @supabase/ssr package
- Create the Supabase server client at /lib/db/server.ts (for API routes)
- Create the Supabase browser client at /lib/db/browser.ts (for client components)
- Create middleware at middleware.ts to refresh auth sessions on every request
- Create auth helper at /lib/auth/requireAuth.ts that:
  - Reads the session from Supabase
  - Returns the user or redirects to /login
  - Used in all protected API routes

Auth routes needed:
- /app/login/page.tsx — email + password login form
- /app/signup/page.tsx — signup form
- /app/api/auth/callback/route.ts — OAuth callback handler
```

### Step 4.3 — Stripe webhook

```
Use the `security-guidance` skill specifically for Stripe webhook security.

Then build /app/api/stripe/webhook/route.ts:

Events to handle:
- checkout.session.completed → create user record in Supabase users table, set plan_tier from price metadata
- customer.subscription.updated → update plan_tier in users table
- customer.subscription.deleted → set plan_tier back to 'free'

Security requirements:
- Verify Stripe signature using STRIPE_WEBHOOK_SECRET on every request
- Use raw body (not parsed JSON) for signature verification
- Reject any request that fails signature check with 400
- Idempotency: check if event has already been processed before acting

Log every webhook event to a webhooks_log table (add this to your migration).
```

### Step 4.4 — Auth guard all protected routes

```
Update these API routes to require authentication:
- POST /api/scan — requires auth, uses authenticated user's plan tier
- GET /api/card/[id]/prices — requires auth
- POST /api/scan/correct — requires auth, verifies ownership

Pattern to use in each:
const user = await requireAuth(request) — returns user or throws 401
const planTier = await getUserPlanTier(user.id) — from /lib/db/users.ts

Update the scan rate limiting to use the actual authenticated user, not a userId from the request body (that was a temporary placeholder).
```

### Step 4.5 — Verify, commit, handoff

```
Use `security-guidance` skill for a final pass on the auth implementation:
- Is the webhook signature verification correct?
- Are there any routes that should be protected but aren't?
- Is the Supabase service role key used anywhere it shouldn't be?

Fix anything. Then:
`commit-push-pr` skill: "Session 4: Supabase Auth, Stripe subscriptions, webhook handler, plan tier gating"
`handoff` skill → save as HANDOFF.md
```

---

## SESSION 5 — Chrome Extension Scaffold
**Goal:** Working Manifest V3 extension that captures a frame from a stream and calls the scan API
**Duration:** 3 hours
**Plugins active:** Matt Pocock skills, superpowers-chrome, codex

---

### Step 5.0 — Session start

Update CLAUDE.md. Then:

```
Read CLAUDE.md. Session 5. Goal: Chrome extension that screenshots a stream and calls our scan API.

Use `context7` to pull the latest Chrome Extension Manifest V3 documentation, specifically:
- chrome.tabs.captureVisibleTab permissions and usage
- Content script to background service worker messaging
- How to make fetch requests from a service worker (not content script) to avoid CORS
- chrome.storage.local for persisting user auth token

Then use `zoom-out` skill to map the extension architecture before we write any files.
```

### Step 5.1 — Extension scaffold

```
Use `dispatching-parallel-agents` from superpowers to build the extension scaffold in parallel.

Agent 1: Build the manifest and background service worker
- /extension/manifest.json — Manifest V3
  Permissions needed: activeTab, storage, scripting
  Host permissions: https://whatnot.com/*, https://www.tiktok.com/*, https://www.instagram.com/*, https://www.youtube.com/*
  Background: service_worker pointing to background/index.ts
  Content scripts: match all host permission URLs
  Commands: _execute_action, "scan-card": { suggested_key: { default: "Ctrl+Shift+S" }, description: "Scan card" }

- /extension/background/index.ts — service worker
  Listen for "SCAN_REQUEST" message from content script
  Call chrome.tabs.captureVisibleTab to get screenshot
  Resize image to max 1024px (use OffscreenCanvas)
  POST to our API at /api/scan with the auth token from chrome.storage
  Send result back to content script via message
  Handle auth: if 401 response, send "AUTH_REQUIRED" message to content script

Agent 2: Build the content script
- /extension/content/index.ts
  Listen for the Ctrl+Shift+S hotkey
  Send "SCAN_REQUEST" message to background
  Listen for scan result or error messages
  Show a brief "scanning..." indicator (simple div injection)
  Pass result to the floating panel component
```

### Step 5.2 — Build the floating panel

```
Use the `frontend-design` skill and `prototype` skill together.

Build the floating panel at /extension/content/panel/

This panel injects into any supported streaming page and shows scan results.

Design requirements (dark mode, stream overlay aesthetic):
- Compact state: 280px wide, shows card name + price badge + confidence dot
  - Green dot: confidence > 0.8
  - Yellow dot: confidence 0.5–0.8
  - Red dot: confidence < 0.5
- Expanded state (click to expand): shows full card details + last 5 sales list + price trend arrow
- Drag to reposition (mousedown + mousemove)
- Minimize button collapses to just the CardSnap icon (16x16)
- Position: bottom-right corner by default, persists via chrome.storage
- Animation: slide in from right on first appearance, fade in on subsequent scans
- Loading state: pulsing skeleton while scan is in progress
- Error state: shows error message with retry button

Colors:
- Background: rgba(15, 15, 15, 0.92)
- Border: rgba(255, 255, 255, 0.08)
- Price badge: green (#22c55e) for below eBay avg, red (#ef4444) for above, gray for unknown
- Text: white primary, rgba(255,255,255,0.6) secondary

Build it as vanilla TypeScript with CSS-in-JS (no React — keeps the extension bundle small).
```

### Step 5.3 — Test in a real browser

```
Use `superpowers-chrome` browsing skill to:
1. Open whatnot.com in the test browser
2. Load the unpacked extension from /extension/dist/
3. Navigate to a live break
4. Trigger the Ctrl+Shift+S hotkey
5. Show me what happens — does the panel appear? Does the scan request go through?

If there are errors, read the extension console and content script errors.
```

### Step 5.4 — Build the extension popup

```
Build the extension popup at /extension/popup/

This shows when user clicks the extension icon in the toolbar.

Contents:
- If not logged in: "Sign in to CardSnap" button linking to cardsnap.io/login
- If logged in:
  - Plan tier badge (Free / Basic / Pro / Streamer)
  - Scans used today / daily limit
  - Last 3 scans (card name + price)
  - "Open Dashboard" link
  - Toggle: auto-scan mode on/off (only shows for Pro+)
  - Sign out button

Keep it simple — 320px wide, no external dependencies.
```

### Step 5.5 — Verify, commit, handoff

```
Use `verification-before-completion` skill:
- Does the extension load without errors on Whatnot, TikTok, Instagram, YouTube?
- Does the hotkey work on all four platforms?
- Is the auth token stored securely in chrome.storage.local (not .sync)?
- Does the panel not interfere with the host page's layout or scroll?

Fix anything. Then:
`commit-push-pr` skill: "Session 5: Chrome extension scaffold, floating panel, popup"
`handoff` skill → save as HANDOFF.md
```

---

## SESSION 6 — Dashboard & Landing Page
**Goal:** Web app pages — landing, dashboard, scan history, pricing page with Stripe checkout
**Duration:** 3 hours
**Plugins active:** frontend-design, Matt Pocock skills, Stripe MCP

---

### Step 6.0 — Session start

Update CLAUDE.md. Then:

```
Read CLAUDE.md. Session 6. Goal: web app pages.

Use `context7` to pull the latest shadcn/ui documentation.

Then use `code-architect` from the feature-dev plugin to plan the page architecture before building. I want to know:
- Which pages are Server Components vs Client Components
- Where does Supabase auth get checked for protected pages
- How does the pricing page interact with Stripe MCP
```

### Step 6.1 — Landing page

```
Use the `frontend-design` skill.

Build the landing page at /app/page.tsx.

Target audience: sports card collectors who watch live breaks on Whatnot, Instagram, TikTok.
They are 18–45, casual to serious collectors, comfortable with browser extensions.
They care about: not overpaying, being fast on good deals, looking smart in breaks.

Page sections in order:
1. Hero: "Know what every card is worth. In 3 seconds." — Install Chrome Extension CTA + "See it work" demo link. Show a mock overlay screenshot on a stream image.
2. How it works: 3 steps — Install extension, press Ctrl+Shift+S on any card, see price instantly. Use icons, keep it short.
3. Social proof: "Join X collectors already scanning" (starts at a believable small number like 47 once you have beta users)
4. Pricing: 4 tier cards — Free, Basic $7, Pro $15, Streamer $29. Each with feature list. CTA buttons per tier.
5. FAQ: 5 questions — Does it work on mobile? What sports are supported? How accurate is it? Is my data private? What if the AI gets it wrong?
6. Footer: Links, legal, attribution note "Prices from eBay"

Design: dark background (#0a0a0a), card imagery feel, trust-focused. NOT flashy. Collectors are skeptical.
```

### Step 6.2 — Dashboard

```
Build the dashboard at /app/dashboard/page.tsx.

This is a protected page — redirect to /login if not authenticated.

Sections:
1. Header: "Welcome back, [name]" + plan tier badge + scans today counter
2. Quick scan panel: drag-and-drop image upload → calls /api/scan → shows result inline (for users who want to scan without the extension)
3. Recent scans table: last 20 scans with — card name, set, parallel, scanned price, eBay avg, deal indicator (above/below avg), date, platform (Whatnot/Instagram/etc.)
4. Stats bar: total scans, money saved (sum of positive differences between scan price and eBay avg), most scanned player, best deal found
5. Watchlist preview: first 3 watched cards with current price — "Manage watchlist" link

All data fetched server-side using Supabase server client.
```

### Step 6.3 — Pricing page with Stripe checkout

```
Use the Stripe MCP to get the exact price IDs for the CardSnap products we created in Session 4.

Then build /app/pricing/page.tsx as a Server Component.

Requirements (same architecture as your currentautomations.ca pricing page — Approach A):
- Static pricing content is server-rendered for SEO
- Extract <BuyNowButton> as a Client Component for each tier
- API route at /app/api/checkout/route.ts handles Stripe session creation
- On successful checkout → redirect to /dashboard with ?upgraded=true param
- Show confetti or success banner when ?upgraded=true

The checkout flow:
1. User clicks "Get Basic" (or Pro/Streamer)
2. POST /api/checkout with { priceId, userId }
3. Create Stripe Checkout Session with:
   - success_url: /dashboard?upgraded=true
   - cancel_url: /pricing
   - customer_email from Supabase auth
4. Redirect to Stripe hosted checkout
5. Stripe webhook (already built in Session 4) handles the subscription creation
```

### Step 6.4 — Scan history page

```
Build /app/dashboard/history/page.tsx.

Full scan history with:
- Search by player name
- Filter by sport, date range, platform
- Sort by date, price, deal quality
- Each row expandable to show full AI response and last 10 sales
- Export to CSV button (server action that generates CSV from Supabase query)
- Correction button on each row: opens modal to fix a wrong identification (calls /api/scan/correct)

Pagination: 50 per page, cursor-based (use Supabase's range query).
```

### Step 6.5 — Verify, deploy preview

```
Use `verification-before-completion` skill on the UI:
- Do all pages work without auth where they should?
- Are all protected pages correctly redirecting unauthenticated users?
- Does the pricing page show correct prices from Stripe?
- Is there any sensitive data exposed in client-rendered output?

Then use the Vercel MCP to deploy a preview build. Share the preview URL so I can test it in a real browser.

Then:
`commit-push-pr` skill: "Session 6: landing page, dashboard, pricing with Stripe, scan history"
`handoff` skill → save as HANDOFF.md
```

---

## SESSION 7 — Architecture Review + Hardening
**Goal:** Catch everything that will break in production before anyone uses it
**Duration:** 2 hours
**Plugins active:** security-guidance, code-review, improve-codebase-architecture, systematic-debugging

---

### Step 7.0 — Session start

Update CLAUDE.md. Then:

```
Read CLAUDE.md. Session 7. Goal: full architecture review and hardening before beta launch.

Use `improve-codebase-architecture` skill on the entire codebase. I want:
- Any coupling problems between modules
- Any places where the same logic is duplicated
- File structure issues
- Anything that will be painful to scale

Show me the findings before making any changes.
```

### Step 7.1 — Security review

```
Use the `security-review` skill (from the Other skills list) on the full codebase.

Focus areas:
1. The scan API endpoint — can it be abused?
2. The Stripe webhook — is signature verification actually working?
3. Supabase RLS policies — can a user access another user's scan history?
4. The Chrome extension — does it send auth tokens securely?
5. Environment variables — is anything that should be secret exposed anywhere?

List every finding with severity: critical / high / medium / low.
Fix all critical and high before we continue.
```

### Step 7.2 — Performance review

```
Use `grill-me` skill on the scan endpoint performance.

I need this endpoint to return in under 3 seconds end to end. Walk me through:
- Where are the slow parts? (GPT-4o call is the obvious one — what's the p95 latency?)
- Does the cache layer actually help? What's a realistic cache hit rate in production?
- What happens when eBay API is slow or down?
- What's the database query performance on the fuzzy card match?

For each bottleneck, suggest a fix. Implement any fixes that don't require major rework.
```

### Step 7.3 — Error handling audit

```
Use `systematic-debugging` skill in audit mode.

Go through every API route and check:
- What happens if GPT-4o returns an unexpected format?
- What happens if eBay API returns 503?
- What happens if Supabase is down?
- What happens if a user's Stripe subscription expires mid-session?
- What happens if the Chrome extension sends a malformed image?

For each scenario: is there a graceful error response? Is the error logged somewhere useful?

Fix any gaps. Every unhandled error should return a typed error response, never a 500 with stack trace.
```

### Step 7.4 — Load test the scan endpoint

```
Use `codex` to help write a simple load test script at /scripts/load-test.ts.

Test: 50 concurrent scan requests from 50 different mock users
Measure: response time p50, p95, p99, error rate
Expected: p95 under 4 seconds, error rate under 1%

Run it against the Vercel preview. Show me the results.
If p95 is over 4 seconds, we need to optimize before launch.
```

### Step 7.5 — Fix and commit

```
List everything found in Steps 7.0–7.4. Fix everything critical and high priority.

For medium/low: create GitHub issues using `to-issues` skill so they're tracked for post-launch.

Then:
`commit-push-pr` skill: "Session 7: security hardening, architecture improvements, error handling"
`handoff` skill → save as HANDOFF.md
```

---

## SESSION 8 — Mobile Camera Mode + PWA
**Goal:** Works on iPhone without App Store — point camera at screen to scan
**Duration:** 2–3 hours
**Plugins active:** frontend-design, Matt Pocock skills, superpowers-chrome (for testing)

---

### Step 8.0 — Session start

Update CLAUDE.md. Then:

```
Read CLAUDE.md. Session 8. Goal: mobile camera mode.

Use `context7` to pull the latest documentation for:
- MediaDevices.getUserMedia() — camera access in Safari iOS
- Canvas API for capturing frames from a video stream
- Web Share API for sharing scan results
- navigator.vibrate() for haptic feedback

Then use `code-architect` to plan the mobile page architecture. Key constraint: this must work in Safari on iOS 16+ without any App Store install.
```

### Step 8.1 — Camera scan page

```
Build /app/scan/page.tsx — the mobile camera scanner.

Layout (mobile-first, portrait):
- Top 65%: camera viewfinder (live video element)
  - Overlay: corner brackets showing where to center the card
  - "Card detected" indicator appears when the heuristic detects a rectangular object
- Bottom 35%: result panel (slides up when result arrives)
  - Loading: "Scanning..." with spinner
  - Result: card name, parallel, price badge (large), last 3 sales
  - "Correction?" link that opens the correction flow
  - Share button (Web Share API) — shares: "Just scanned a [card] worth $[price] on CardSnap"

Scan trigger:
- Tap anywhere on viewfinder to capture
- Auto-scan option (toggleable): captures every 5 seconds if a card-like shape is detected

Camera implementation:
- getUserMedia({ video: { facingMode: 'environment' } }) — rear camera on mobile
- Capture frame to canvas, resize to 800px max, convert to jpeg base64
- POST to /api/scan same as extension
- Haptic feedback on result: navigator.vibrate([100, 50, 100])

Permissions flow:
- First load: explain why camera is needed before requesting permission
- If denied: show instructions for how to grant it in Safari settings
```

### Step 8.2 — PWA config

```
Configure the app as a Progressive Web App so users can add it to their home screen.

Requirements:
- /public/manifest.json with name, short_name, icons, theme_color, display: standalone
- Icons: 192x192 and 512x512 (generate simple logo icons)
- /app/layout.tsx: add viewport meta tag, theme-color meta tag, manifest link
- Service worker at /public/sw.js for offline support of scan history
  - Cache the last 50 scan results for offline viewing
  - Cache app shell for offline load

Add "Add to Home Screen" prompt: show a banner on /scan page if the app is not already installed and the user is on mobile.
```

### Step 8.3 — Final end-to-end test

```
Use `superpowers-chrome` browsing skill to run an end-to-end test:

Scenario 1 — Extension flow:
1. Open Whatnot.com on a live break
2. Press Ctrl+Shift+S when a card is visible
3. Verify panel appears with card name and price
4. Verify the price matches what we'd expect for that card

Scenario 2 — Web dashboard flow:
1. Log in at cardsnap.io
2. Upload a card image in the dashboard
3. Verify correct identification and pricing
4. Check scan history shows the new scan

Scenario 3 — Pricing flow:
1. Sign up as a free user
2. Attempt 11 scans (should hit rate limit on 11th)
3. Upgrade to Basic via pricing page
4. Verify 11th scan now works

Report any failures. Fix all failures before the final commit.
```

### Step 8.4 — Final commit and launch prep

```
Use `verification-before-completion` skill for final launch readiness check.

Checklist:
- All TypeScript errors resolved?
- All tests passing?
- No console.log statements in production code?
- Environment variables documented in .env.example?
- README.md written?
- Chrome Web Store listing assets ready? (needs 1280x800 screenshot, 440x280 promo tile, icons)
- Stripe products verified in production mode (not test mode)?
- eBay API keys in production mode?
- Supabase project in production mode with backups enabled?

Fix anything not checked. Then:
`commit-push-pr` skill: "Session 8: mobile camera mode, PWA config, final hardening"
`handoff` skill → save as HANDOFF.md

Then use the Vercel MCP to deploy to production.
```

---

## Post-Launch — Ongoing Operations

### Weekly routine (30 minutes, Mondays)

```
Read CLAUDE.md.

Use `episodic-memory search-conversations` to recall any issues from last week.

Pull this week's scan logs from Supabase:
- Total scans
- Identification accuracy rate (scans where was_corrected = false / total)
- Most common correction reasons
- Any cards with very low confidence scores that slipped through

Use `grill-with-docs` skill to pressure-test any new prompt changes against the accuracy data before deploying them.
```

### When a new card set releases (use Make.com automation)

The Make.com scenario from Phase 5 handles detection automatically. When it notifies you:

```
New card set detected: [set name]

Use `context7` to research this set — what parallels exist, what's the checklist, what are the key rookie cards.

Then update the identification prompt to include explicit examples of this set's naming conventions. Test the updated prompt against 10 screenshots before deploying.

Use `tdd` to add test cases for the new set before changing the prompt.
```

### When accuracy drops below threshold

```
Use `systematic-debugging` skill.

Our identification accuracy has dropped. Here is the error data: [paste correction logs].

Walk me through diagnosing: is this a prompt issue, a new card set we haven't seen, a change in how a platform renders card images, or a GPT-4o model change?

Fix the root cause, not the symptoms.
```

### When adding TCG support (Phase 6)

Start a fresh Claude Code session with:

```
Read CLAUDE.md. We are beginning Phase 6: TCG plugin layer.

Use `zoom-out` skill to map the current architecture and identify the exact integration points for adding Pokemon and MTG support without breaking the sports card flow.

Then use `to-prd` to generate a Phase 6 PRD. Then `to-issues` to break it into issues.

The key constraint: TCG and sports must be independently toggleable. A user who only cares about sports should never see TCG UI.
```

---

## Quick Reference — Skill Triggers

| Situation | Skill/Plugin to call |
|-----------|---------------------|
| Starting a new phase | `zoom-out` → `to-prd` → `to-issues` |
| Starting any session | `episodic-memory search-conversations` |
| Building a feature | `feature-dev` or `tdd` |
| Parallel independent tasks | `dispatching-parallel-agents` |
| Working with external API | `context7` first, then build |
| UI component needed | `frontend-design` + `prototype` |
| Code is getting complex | `caveman` to simplify |
| Something is broken | `diagnose` → `systematic-debugging` |
| Security-sensitive code | `security-guidance` before + `security-review` after |
| Phase complete | `improve-codebase-architecture` |
| End of any session | `verification-before-completion` → `commit-push-pr` → `handoff` |
| Next session start | paste last HANDOFF.md into CLAUDE.md |
| Context window getting full | `ctx-stats` → `ctx-purge` |
| Codex doing boilerplate | automatic — watch for it in terminal |
| Chrome extension testing | `superpowers-chrome browsing` |
| Stripe operations | Stripe MCP (connected) |
| Vercel deploys | Vercel MCP (connected) |
