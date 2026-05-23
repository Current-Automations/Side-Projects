# CardSnap — Product Requirements Document

## Problem Statement

Sports card collectors and streamers watching live card breaks on Whatnot, TikTok, and Instagram have no way to instantly identify a card and look up its current market value while the stream is happening. By the time a viewer manually searches eBay, checks a pricing site, or asks in the chat, the card has already moved on. Professional breakers and collectors are making buy/sell decisions in seconds — without reliable price data — costing them money on every break they watch.

## Solution

A Chrome extension that integrates directly into the live stream browser tab. The user presses a single hotkey at the moment a card appears on screen. The extension captures the current video frame, sends it to a server-side AI pipeline (GPT-4o vision), and returns the identified card name alongside eBay sold price history — all within 3 seconds, without leaving the stream. A tiered subscription model serves casual collectors through professional streamers who need API-level access for their own tooling.

## User Stories

### Card Identification During a Break

1. As a collector watching a live break, I want to press a hotkey and have the card on screen identified automatically, so that I know what I'm looking at without pausing the stream.
2. As a collector, I want the card identification to complete in under 3 seconds, so that the result is still relevant before the next card appears.
3. As a collector, I want to see the full card name (player, year, set, variant) in the scan result, so that I can distinguish parallels and numbered cards.
4. As a collector, I want to see the card's current eBay sold price in the scan result, so that I can instantly gauge its market value.
5. As a collector, I want to see the last 10 eBay sold listings for the identified card, so that I can assess price trends and volatility.
6. As a collector, I want the scan result to appear as a non-blocking overlay or popup, so that it doesn't obscure the stream I'm watching.
7. As a collector, I want the scan result to persist on screen until I dismiss it or trigger a new scan, so that I have time to read the pricing data.
8. As a collector, I want the extension to work on Whatnot, TikTok, and Instagram Live, so that I don't need different tools for different platforms.

### Correction Flow

9. As a collector, I want to submit a correction when the AI misidentifies a card, so that I can get the right pricing data for what I actually saw.
10. As a collector, I want the correction form to be accessible from the scan result popup, so that I don't have to navigate away to report an error.
11. As a collector, I want to type the correct card name into the correction form, so that my feedback is specific and actionable.
12. As a collector, I want to see corrected pricing data immediately after submitting a correction, so that the session remains useful even when the AI makes a mistake.

### Rate Limiting and Plan Awareness

13. As a free-tier user, I want to know how many scans I have remaining today, so that I can budget my hotkey presses during a long break.
14. As a free-tier user who has hit my daily scan limit, I want a clear message explaining why my scan didn't run, so that I'm not confused by a silent failure.
15. As a free-tier user approaching my limit, I want to see a prompt to upgrade my plan, so that I can make an informed decision before hitting the wall.
16. As a Basic plan user, I want 100 scans per day, so that I can scan actively throughout multiple breaks without running out.
17. As a Pro or Streamer plan user, I want unlimited scans per day, so that I can use the hotkey freely without ever thinking about quotas.

### Account and Subscription Management

18. As a new user, I want to create a CardSnap account directly from the extension popup, so that I can get started without visiting a separate website.
19. As a new user, I want to log in with my email and password via the extension popup, so that my scan history and plan tier persist across browser sessions.
20. As a subscriber, I want to upgrade my plan from within the extension, so that I don't have to leave my workflow.
21. As a subscriber, I want my plan tier to be reflected immediately after a Stripe payment completes, so that my new scan quota is available right away.
22. As a subscriber, I want to receive a clear error if my subscription lapses, so that I understand why my scans are failing.

### Streamer and API Use

23. As a Streamer plan subscriber, I want API access credentials, so that I can integrate CardSnap scan results into my own streaming overlay or tools.
24. As a Streamer plan subscriber, I want the API to accept a base64-encoded image and return the same scan result payload as the extension, so that I can build on a stable contract.
25. As a Streamer plan subscriber, I want API usage to count against a separate unlimited quota, so that my programmatic usage doesn't interfere with my extension scans.

### Privacy and Data

26. As a user, I want to know that my stream video is never stored on CardSnap servers, so that I can trust the extension with my streaming sessions.
27. As a user, I want only the scan result (card name, prices, timestamp) to be stored, not the raw screenshot, so that my data footprint is minimal.

### Attribution and Trust

28. As a user viewing eBay pricing data, I want to see "Prices from eBay" attribution wherever prices are displayed, so that I know the source of the data.
29. As a user, I want pricing data to be no older than 4 hours, so that I'm not making decisions on stale market data.

## Implementation Decisions

### Module Architecture

**`lib/types`** — The foundational layer. All Zod schemas and TypeScript types live here. All API routes return discriminated unions: `{ success: true, data: T } | { success: false, error: string }`. Every external API response shape is validated with a Zod schema — no exceptions. Environment variables are validated with Zod at startup. This module has no dependencies on any other internal module.

**`lib/ai`** — Deep module encapsulating GPT-4o vision identification. Accepts a base64-encoded image string, returns a structured `CardIdentification` type (player, year, set, variant, confidence). Internally constructs the prompt, calls the OpenAI API, validates the response with Zod, and handles retries. Callers never interact with the OpenAI SDK directly — only with this module's interface.

**`lib/pricing`** — Deep module encapsulating eBay Browse API access and the cache layer. Accepts a card identity string, returns a `PricingResult` type (current sold price, last 10 sales). Implements a two-tier cache: card metadata at 24h TTL, pricing data at 4h TTL. Callers never interact with eBay or the cache directly. The "Prices from eBay" attribution requirement is enforced at the type level (the return type includes an `attribution` field that must be rendered).

**`lib/db`** — Deep module for all Supabase access. Typed query helpers for: scan result writes, rate-limit counter reads/decrements, user plan tier lookups, correction queue inserts. No raw Supabase queries outside this module. Enforces the business rule that screenshots are never written — only scan result data.

**`POST /api/scan`** — The orchestration endpoint. Sequence: validate auth JWT → check rate limit by plan tier → call `lib/ai` → call `lib/pricing` → call `lib/db` (write result, decrement quota) → return scan result. If rate limit is exceeded, returns `{ success: false, error: "RATE_LIMIT_EXCEEDED", remaining: 0 }` before touching AI or pricing. The screenshot is discarded server-side immediately after the AI call completes.

**`GET /api/card/[id]/prices`** — Cache-first price lookup for a previously identified card. Delegates entirely to `lib/pricing`. Allows the popup to refresh pricing for a card without re-running identification.

**`POST /api/scan/correct`** — Accepts a correction payload (original scan ID, corrected card name). Writes to the corrections queue in Supabase, then triggers a fresh `lib/pricing` lookup for the corrected identity and returns updated pricing. Does not decrement scan quota.

**`POST /api/stripe/webhook`** — Receives Stripe subscription events. On `customer.subscription.updated` and `customer.subscription.deleted`, updates the user's plan tier in Supabase via `lib/db`. Rate limit counters reset at midnight UTC per user.

**Extension: content script** — Injected into Whatnot, TikTok, and Instagram Live tabs. Listens for the configured hotkey. On activation, locates the `<video>` element in the DOM, draws the current frame to an off-screen `<canvas>`, and exports as base64 PNG. Sends the base64 string to the background service worker via `chrome.runtime.sendMessage`. If cross-origin video capture is blocked by the platform, surfaces a clear error to the popup.

**Extension: background service worker** — Receives screenshot messages from content scripts. Retrieves the Supabase auth token from `chrome.storage` (MV3 — no cookies, no localStorage). POSTs to `/api/scan`. Relays the response to the popup. Handles token refresh if the stored JWT is expired. All network calls happen here — the content script and popup make no direct API calls.

**Extension: popup UI** — Renders scan results: card name, current sold price, last 10 sales list with "Prices from eBay" attribution, remaining scan count, and a correction form. Built with React and shadcn/ui components. Communicates with the background worker only via `chrome.runtime.sendMessage` — no direct API calls.

### Key Technical Constraints

- Rate limiting is enforced server-side on every request. The client displays the remaining count as a UX convenience only — it is never trusted.
- The scan pipeline must complete in under 3 seconds end-to-end under normal load. GPT-4o vision and eBay API calls must run sequentially (pricing depends on identification), so prompt engineering and cache hit rate are the primary latency levers.
- MV3 service workers are ephemeral — no in-memory state survives between invocations. All auth tokens are persisted in `chrome.storage.local` and validated on each background worker wake.
- Screenshots are never persisted. The base64 image string is passed in-memory through the pipeline and discarded after the AI call.

### API Contract (Scan Endpoint)

```
POST /api/scan
Authorization: Bearer <supabase-jwt>
Body: { image: string }  // base64-encoded PNG

200: {
  success: true,
  data: {
    scanId: string,
    card: { player: string, year: number, set: string, variant: string | null },
    pricing: {
      currentPrice: number,
      sales: Array<{ date: string, price: number, condition: string }>,
      attribution: "Prices from eBay"
    },
    remainingScans: number | null  // null = unlimited
  }
}

429: { success: false, error: "RATE_LIMIT_EXCEEDED", remaining: 0 }
401: { success: false, error: "UNAUTHORIZED" }
500: { success: false, error: string }
```

## Testing Decisions

**What makes a good test**: Tests verify external behavior, not implementation details. A good test calls the module's public interface, provides realistic inputs, and asserts on outputs — without asserting on internal state, intermediate values, or which private functions were called. Tests should remain valid even if the module is entirely rewritten internally.

### Modules to Test

**`lib/ai`** — Test with fixture base64 images (real stream screenshots). Assert that valid inputs return a correctly shaped `CardIdentification`. Assert that malformed OpenAI responses (missing fields, wrong types) are caught by Zod and surface as typed errors — not unhandled exceptions. Do not assert on the exact prompt string.

**`lib/pricing`** — Test the cache behavior: first call hits eBay API, second call within TTL returns cached data without a network call. Test that the `attribution` field is always present in the return value. Test that expired cache entries trigger a fresh eBay call. Use a mock eBay API (not a mock of internal cache logic).

**`lib/db`** — Test against a real Supabase instance (local or test project). Assert that rate-limit counters decrement correctly. Assert that scan results are written with the correct fields. Assert that screenshots are never written (the insert payload type should make this structurally impossible — verify the type rejects image data).

**`POST /api/scan`** — Integration test the full pipeline using test credentials and fixture images. Assert on the shape of the response discriminated union. Assert that a user at their rate limit receives a 429 before any AI or eBay calls are made (verify by asserting `lib/ai` was not called when limit is 0 — via a spy, not a mock of internals).

**Extension content script** — Manual test on each target platform (Whatnot, TikTok Live, Instagram Live) to verify `drawImage()` succeeds on the video element. This is a platform-compatibility test, not a unit test — automate only the happy path in a controlled environment.

## Out of Scope

- iOS or Android mobile apps. The MVP is Chrome extension only.
- Firefox or Safari extension support.
- Video-level card tracking (automatically detecting cards as they appear). The MVP is hotkey-triggered, not autonomous.
- Card value alerts or watchlists.
- A social or community feed of scans.
- Card authentication or grading integration (PSA, SGC, BGS).
- Bulk scanning or import from images not captured live.
- A web dashboard for scan history (web app UI is lowest priority; the extension popup is the primary interface at launch).
- The 130point pricing source (mentioned in CLAUDE.md; deprioritized until eBay integration is stable and a second source is validated).
- Fine-tuning pipeline for AI correction feedback (corrections are collected now; the active-learning loop is a Phase 2 concern).

## Further Notes

- **Screenshot capture validation is the critical path blocker.** Before any backend work is reviewed, a spike must confirm that `drawImage()` on the live `<video>` element succeeds on Whatnot, TikTok, and Instagram. These platforms may use cross-origin video, DRM, or canvas-blocking policies that make the entire product concept unworkable in its current form. This spike should produce a yes/no answer with platform-specific notes.
- **eBay Browse API business approval** must be applied for before pricing work begins. If approval is pending, the pricing module should be stubbed with fixture data so the rest of the pipeline can be developed in parallel.
- **The 3-second SLA** is a product promise, not a soft target. Monitor GPT-4o vision p95 latency against this budget from the first integration test. If the AI call alone routinely exceeds 2 seconds, prompt engineering (smaller image, tighter instructions) and response caching by image hash should be evaluated.
- **Plan tier source of truth is Supabase**, updated by the Stripe webhook. The extension reads this from the JWT claims or a DB lookup — never from a client-side value. Any mismatch between Stripe state and Supabase state should alert.
- The Stack section of CLAUDE.md lists Next.js 14, but the installed version is Next.js 16. Read `node_modules/next/dist/docs/` before writing any App Router code, as noted in AGENTS.md.
