# CardSnap — Issue Backlog

Vertical slices ordered by phase and dependency. Each slice is end-to-end and demoable in isolation.
**Type key:** HITL = requires human decision or manual test · AFK = agent-completable without human interaction
**Complexity:** S = hours · M = 1–2 days · L = 3–5 days

---

## Phase 0 — Validation Spike

### ISSUE-01 · Screenshot capture spike · HITL · S

**What to build**
Validate that a Chrome extension content script can capture a frame from a live `<video>` element on Whatnot, TikTok Live, and Instagram Live using `drawImage()` on an off-screen `<canvas>`. Produce a minimal extension that logs a base64 PNG to the console when a hotkey is pressed on each platform. Document findings per platform — success, cross-origin error, canvas-blocking, or DRM block.

**Acceptance criteria**
- [ ] Spike extension installs and runs on Chrome without errors
- [ ] Hotkey triggers `drawImage()` against the stream video element on Whatnot — result documented (success or failure + error type)
- [ ] Same test performed on TikTok Live — result documented
- [ ] Same test performed on Instagram Live — result documented
- [ ] If any platform blocks capture, a fallback approach is proposed (e.g. media stream capture, native messaging) or the platform is marked unsupported
- [ ] Findings written up as a brief ADR — decision recorded, no code merged

**Blocked by:** None — start immediately

---

## Phase 1 — Foundation Libraries

### ISSUE-02 · `lib/types` — Zod schemas and API contracts · AFK · S

**What to build**
Create the shared type layer that every other module depends on. All Zod schemas for external API responses, the discriminated-union response envelope for every API route, and startup environment variable validation live here. No business logic — types and validation only.

**Acceptance criteria**
- [ ] Discriminated union response envelope `{ success: true, data: T } | { success: false, error: string }` is defined and exported
- [ ] Zod schema for the `/api/scan` request body (base64 image string) is defined
- [ ] Zod schema for the scan result payload (card identity + pricing + remaining scans) is defined, including a required `attribution: "Prices from eBay"` field
- [ ] Zod schema for the correction submission payload is defined
- [ ] Environment variable schema (OpenAI key, eBay credentials, Supabase URL/key, Stripe webhook secret) validates at import time and throws a typed error if any are missing
- [ ] `any` does not appear anywhere in this module — TypeScript strict mode passes

**Blocked by:** None — start immediately

---

### ISSUE-03 · `lib/ai` — GPT-4o vision card identification · AFK · M

**What to build**
Build the AI identification module. Accepts a base64-encoded PNG, returns a structured `CardIdentification` (player, year, set, variant, confidence). Internally constructs the prompt, calls the OpenAI API, and validates the response with a Zod schema. Callers never touch the OpenAI SDK.

**Acceptance criteria**
- [ ] Module exports a single async function with signature `identify(imageBase64: string): Promise<CardIdentification>`
- [ ] Returns correctly shaped `CardIdentification` for a test fixture of a real card scan (happy path)
- [ ] Malformed or incomplete OpenAI responses (missing fields, unexpected types) are caught by Zod and returned as a typed `{ success: false, error: string }` — no unhandled exceptions
- [ ] OpenAI API errors (timeout, rate limit, network) are caught and returned as typed errors
- [ ] The module does not retain or log the image data
- [ ] Unit tests cover: happy path with fixture image, Zod validation failure on bad response, API error propagation

**Blocked by:** ISSUE-02 (types)

---

### ISSUE-04 · `lib/pricing` — eBay Browse API client and cache · AFK · M

**What to build**
Build the pricing module. Accepts a card identity string, returns a `PricingResult` containing the current eBay sold price, the last 10 sold listings, and a required attribution field. Implements a two-tier cache: 4-hour TTL for pricing data, 24-hour TTL for card metadata. Callers never interact with eBay or the cache directly.

**Acceptance criteria**
- [ ] Module exports a single async function with signature `getPrice(cardIdentity: string): Promise<PricingResult>`
- [ ] `PricingResult` always contains `attribution: "Prices from eBay"` — this is structurally enforced by the type
- [ ] First call for an uncached card hits the eBay Browse API and caches the result
- [ ] Second call within 4 hours returns cached data without a network call (verified in tests via a spy on the eBay client, not mock internals)
- [ ] Cache entry older than 4 hours triggers a fresh eBay API call
- [ ] eBay API errors are returned as typed errors — no unhandled exceptions
- [ ] Unit tests cover: cache hit, cache miss, cache expiry, eBay API error

**Blocked by:** ISSUE-02 (types)

---

### ISSUE-05 · `lib/db` — Supabase typed query helpers and rate limiting · AFK · M

**What to build**
Build the database access module. Typed helpers for: scan result writes, rate-limit counter reads/decrements, user plan tier lookups, and correction queue inserts. All Supabase access goes through this module — no raw queries elsewhere.

**Acceptance criteria**
- [ ] `writeScanResult(result: ScanResult): Promise<void>` writes to the scan results table — the input type structurally cannot include image data (no `image` or `screenshot` field)
- [ ] `getRateLimit(userId: string): Promise<{ remaining: number | null }>` returns `null` for unlimited-tier users
- [ ] `decrementRateLimit(userId: string): Promise<void>` decrements the counter atomically
- [ ] `getUserPlanTier(userId: string): Promise<PlanTier>` returns the correct tier
- [ ] `insertCorrection(correction: Correction): Promise<void>` writes to the corrections queue
- [ ] All functions tested against a real Supabase test project (not mocked Supabase internals)
- [ ] Rate limit counter decrement is idempotent at zero (does not go negative)

**Blocked by:** ISSUE-02 (types)

---

## Phase 2 — API Layer

### ISSUE-06 · `POST /api/scan` — main scan orchestration endpoint · AFK · L

**What to build**
Build the primary scan API route. Sequence: validate Supabase JWT → check rate limit by plan tier → call `lib/ai` → call `lib/pricing` → write result via `lib/db` → return scan payload. Rate-limited requests must return 429 before any AI or eBay calls are made.

**Acceptance criteria**
- [ ] Valid request with a fixture image and valid JWT returns `{ success: true, data: { scanId, card, pricing, remainingScans } }` with status 200
- [ ] `pricing.attribution` is always `"Prices from eBay"` in the response
- [ ] Request with an expired or missing JWT returns `{ success: false, error: "UNAUTHORIZED" }` with status 401
- [ ] Request from a user at their daily scan limit returns `{ success: false, error: "RATE_LIMIT_EXCEEDED", remaining: 0 }` with status 429 — `lib/ai` is not called (verified by spy)
- [ ] Unlimited-tier users (Pro/Streamer) are never rejected by rate limiting
- [ ] The base64 image string is not written to any database table or log
- [ ] Integration test covers full pipeline end-to-end with real Supabase test project and mocked OpenAI/eBay responses

**Blocked by:** ISSUE-03 (lib/ai), ISSUE-04 (lib/pricing), ISSUE-05 (lib/db)

---

### ISSUE-07 · `GET /api/card/[id]/prices` — cache-first price refresh · AFK · S

**What to build**
Build the price refresh endpoint. Accepts a card ID previously returned by `/api/scan`, delegates to `lib/pricing` cache-first, and returns updated pricing data. Allows the popup to refresh prices without re-running identification.

**Acceptance criteria**
- [ ] Valid request returns `{ success: true, data: { pricing } }` where `pricing.attribution` is always present
- [ ] Response is served from cache if the cached entry is under 4 hours old
- [ ] Unknown card ID returns `{ success: false, error: "NOT_FOUND" }` with status 404
- [ ] No auth required (prices are public data)

**Blocked by:** ISSUE-04 (lib/pricing)

---

### ISSUE-08 · `POST /api/scan/correct` — correction submission · AFK · S

**What to build**
Build the correction endpoint. Accepts a correction payload (original scan ID, corrected card name), writes it to the corrections queue, then triggers a fresh pricing lookup for the corrected identity and returns updated pricing. Does not decrement the scan quota.

**Acceptance criteria**
- [ ] Valid correction request writes to the corrections queue in Supabase
- [ ] Response includes fresh pricing data for the corrected card identity
- [ ] `pricing.attribution` is always present in the response
- [ ] Submitting a correction does not decrement the user's remaining scan count
- [ ] Request with an invalid scan ID returns `{ success: false, error: "NOT_FOUND" }` with status 404
- [ ] Requires valid JWT (a user must own the original scan)

**Blocked by:** ISSUE-04 (lib/pricing), ISSUE-05 (lib/db)

---

### ISSUE-09 · `POST /api/stripe/webhook` — subscription event handler · AFK · M

**What to build**
Build the Stripe webhook handler. Validates the Stripe signature, handles `customer.subscription.updated` and `customer.subscription.deleted` events, and updates the user's plan tier in Supabase accordingly.

**Acceptance criteria**
- [ ] Webhook signature validation rejects unsigned or tampered requests with status 400
- [ ] `customer.subscription.updated` event maps Stripe price ID to the correct `PlanTier` and updates Supabase
- [ ] `customer.subscription.deleted` event downgrades the user to Free tier in Supabase
- [ ] Unknown event types are acknowledged (200) and ignored without error
- [ ] Plan tier update is reflected immediately on the next `/api/scan` rate-limit check
- [ ] Webhook handler is idempotent — replaying the same event does not corrupt user state

**Blocked by:** ISSUE-05 (lib/db)

---

## Phase 3 — Chrome Extension

### ISSUE-10 · Extension scaffold — manifest, build config, and dev workflow · AFK · S

**What to build**
Set up the Chrome extension project under `/extension` with Manifest V3 structure, a TypeScript/bundler config, and a working dev build. No functional code yet — just the scaffold that subsequent extension issues build on.

**Acceptance criteria**
- [ ] `/extension/manifest.json` is valid Manifest V3 and loads in Chrome without errors
- [ ] Background service worker, content script, and popup entry points are declared in the manifest
- [ ] `npm run build:extension` (or equivalent) produces a loadable extension in `/extension/dist`
- [ ] TypeScript strict mode is enabled for extension code
- [ ] Extension loads on a plain HTML page without console errors

**Blocked by:** ISSUE-01 (spike findings inform manifest permissions)

---

### ISSUE-11 · Extension background service worker — auth and scan API bridge · AFK · M

**What to build**
Build the extension background service worker. Stores and refreshes the Supabase auth JWT in `chrome.storage.local`. Receives screenshot messages from content scripts, POSTs to `/api/scan` with the auth token, and relays the scan result to the popup. All network calls in the extension flow through this worker.

**Acceptance criteria**
- [ ] Auth token is stored in `chrome.storage.local` — not in memory, cookies, or localStorage
- [ ] Expired JWT is refreshed before the scan request is sent — the user is not shown an auth error for a token that can be silently refreshed
- [ ] Missing or unrefreshable token sends `{ type: "AUTH_REQUIRED" }` message to the popup
- [ ] On receipt of a screenshot message from the content script, the worker POSTs to `/api/scan` and relays the response to the popup
- [ ] Rate limit exceeded response is relayed to the popup as a typed message (not swallowed)
- [ ] Worker handles being woken from idle by MV3 correctly — no state is assumed to survive between invocations

**Blocked by:** ISSUE-06 (scan API), ISSUE-10 (scaffold)

---

### ISSUE-12 · Extension content script — hotkey listener and video frame capture · AFK · M

**What to build**
Build the content script injected into stream platform tabs. Listens for the configured hotkey. On activation, locates the `<video>` element, draws the current frame to an off-screen `<canvas>`, exports as base64 PNG, and sends to the background service worker. Handles cross-origin and canvas-block errors gracefully.

**Acceptance criteria**
- [ ] Hotkey triggers frame capture on Whatnot (or the platforms confirmed as supported by ISSUE-01)
- [ ] Captured frame is sent to the background worker as a base64 PNG string via `chrome.runtime.sendMessage`
- [ ] If no `<video>` element is found, a typed error message is sent to the popup (not a silent failure)
- [ ] If `drawImage()` throws a cross-origin security error, a typed error message is sent to the popup with a human-readable explanation
- [ ] Content script does not make any direct API calls
- [ ] Content script does not store the captured image data beyond the single `sendMessage` call

**Blocked by:** ISSUE-01 (spike determines feasibility and platform scope), ISSUE-10 (scaffold), ISSUE-11 (background worker)

---

### ISSUE-13 · Extension popup UI — scan result, correction form, and plan status · AFK · L

**What to build**
Build the extension popup. Renders: identified card name, current eBay sold price, last 10 sales list with "Prices from eBay" attribution, remaining daily scan count (or "Unlimited"), a correction form, and plan/account status. Communicates exclusively with the background service worker via `chrome.runtime.sendMessage`.

**Acceptance criteria**
- [ ] Popup renders the card name, price, and sales list from a scan result message
- [ ] "Prices from eBay" attribution is always visible alongside any pricing data
- [ ] Remaining scan count is displayed for Free and Basic users; "Unlimited" for Pro and Streamer
- [ ] Correction form is accessible from the scan result view and submits via the background worker to `POST /api/scan/correct`
- [ ] After correction submission, the popup updates to show refreshed pricing for the corrected card
- [ ] Rate-limit-exceeded state shows a clear message and an upgrade prompt
- [ ] Auth-required state shows a login/signup prompt
- [ ] Loading state is shown from hotkey press until the result arrives
- [ ] Error states (video not found, capture blocked, API error) each show a distinct, human-readable message

**Blocked by:** ISSUE-11 (background worker), ISSUE-08 (correction endpoint)

---

## Phase 4 — Auth and Billing

### ISSUE-14 · Supabase auth in extension popup — sign up and log in · AFK · M

**What to build**
Build the auth flow inside the extension popup. Email/password sign-up and log-in. On success, stores the JWT in `chrome.storage.local` via the background worker. On sign-out, clears the stored token.

**Acceptance criteria**
- [ ] New user can create a CardSnap account from the popup without visiting the web app
- [ ] Existing user can log in with email and password from the popup
- [ ] On successful auth, JWT is stored in `chrome.storage.local` (not in memory or localStorage)
- [ ] On sign-out, token is cleared from `chrome.storage.local`
- [ ] Auth errors (wrong password, email already exists) show human-readable messages
- [ ] After login, the popup transitions to the scan-ready state without requiring a reload

**Blocked by:** ISSUE-13 (popup UI), ISSUE-10 (scaffold)

---

### ISSUE-15 · Stripe subscription upgrade flow · HITL · M

**What to build**
Build the subscription upgrade path. From the popup (or a linked web page), a user can select a plan and complete a Stripe Checkout session. On payment success, the Stripe webhook (ISSUE-09) updates the user's plan tier. The popup reflects the new tier on next load.

**Acceptance criteria**
- [ ] User can navigate to plan selection from the popup (rate-limit prompt or account screen)
- [ ] Stripe Checkout session is created server-side and opened in a new browser tab
- [ ] On payment success, the user's plan tier is updated via the Stripe webhook within 30 seconds
- [ ] The popup shows the correct new plan tier and scan quota on next open after upgrade
- [ ] Failed or cancelled payment does not change the user's plan tier
- [ ] Stripe test mode is used in development; production keys are gated by environment

**Blocked by:** ISSUE-09 (webhook), ISSUE-13 (popup UI)

---

## Phase 5 — Web App (Deferred)

### ISSUE-16 · Web app landing page · AFK · M

**What to build**
Build a marketing landing page at the web app root. Explains CardSnap's value proposition, shows the plan tiers and pricing, and links to the Chrome extension install page. No auth required.

**Acceptance criteria**
- [ ] Page renders at `/` with plan comparison table (Free, Basic $7, Pro $15, Streamer $29)
- [ ] "Install Extension" CTA links to the Chrome Web Store listing (or a placeholder URL in development)
- [ ] Page is accessible (semantic HTML, keyboard navigable)
- [ ] No eBay pricing data is shown on this page (no attribution requirement applies)

**Blocked by:** None — can be built in parallel with Phase 3

---

### ISSUE-17 · Web app user dashboard — scan history · AFK · L

**What to build**
Build an authenticated dashboard at `/dashboard` showing the user's scan history — card name, price at scan time, scan date — with a link to refresh current pricing. Shows current plan tier and scan quota.

**Acceptance criteria**
- [ ] Unauthenticated users are redirected to a login page
- [ ] Authenticated users see a paginated list of their past scans (card name, price, date)
- [ ] "Prices from eBay" attribution is displayed wherever pricing data appears
- [ ] Each scan row has a "Refresh prices" action that calls `GET /api/card/[id]/prices`
- [ ] Current plan tier and remaining daily scans are displayed in the dashboard header
- [ ] Dashboard renders correctly with 0 scans (empty state)

**Blocked by:** ISSUE-06 (scan API), ISSUE-07 (price refresh API), ISSUE-16 (landing page)

---

## Pokémon-first rebuild (see the rebuild plan for full context)

The 2026-09 discovery session moved CardSnap to Pokémon TCG first, a proprietary
two-stage identifier (card retrieval + finish resolution) over a TCGdex catalog,
and a white-label in-shop game as the label engine. The issues below are the
sports-era backlog; they stay for reference but the rebuild plan supersedes the
ordering.

### KNOWN-BROKEN · extension correction contract · do not fix in place

`extension/src/background.ts` posts `{ scan_id, corrected_name }` to
`POST /api/scan/correct`; the route requires `{ scan_id, user_id, corrected_card: {...} }`.
Every extension correction returns 400. The popup's free-text box cannot produce
the required shape. This has never worked, so there is no correction data.

**Resolution:** the shop game replaces this feedback path entirely (it captures
images next to labels, which the scan path never did). Do not spend effort
resurrecting the in-extension correction flow. If a lightweight "that's wrong"
signal is still wanted in the extension later, design it fresh against the
Pokémon identity shape.

### Superseded / on hold from the sports backlog
- ISSUE-09, ISSUE-15 (Stripe) — no paying users; deferred past the rebuild.
- ISSUE-16, ISSUE-17 (web landing + dashboard) — landing page exists but is
  sports-framed and will be redone; dashboard deferred.
- Fine-tune pipeline (`lib/db/training.ts`) — stays dormant; the rebuild uses
  retrieval, not fine-tuning. `status: 'succeeded'` in that file also violates
  the `training_runs` CHECK constraint (`pending|running|completed|failed`).

---

## Dependency Graph

```
ISSUE-02 (types)
  ├── ISSUE-03 (lib/ai)
  ├── ISSUE-04 (lib/pricing) ── ISSUE-07 (price refresh API)
  └── ISSUE-05 (lib/db)
        └── ISSUE-09 (stripe webhook)

ISSUE-03 + ISSUE-04 + ISSUE-05
  └── ISSUE-06 (scan API)
        └── ISSUE-11 (ext: background worker)

ISSUE-04 + ISSUE-05
  └── ISSUE-08 (correction API)

ISSUE-01 (spike)
  └── ISSUE-10 (ext: scaffold)
        ├── ISSUE-11 (ext: background worker)
        │     └── ISSUE-12 (ext: content script)
        │           └── ISSUE-13 (ext: popup UI)
        │                 ├── ISSUE-14 (auth flow)
        │                 └── ISSUE-15 (stripe upgrade)
        └── ISSUE-14 (auth flow)

ISSUE-16 (landing page) ── ISSUE-17 (dashboard)
```
