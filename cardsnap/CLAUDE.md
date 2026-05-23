@AGENTS.md

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
Session 1 — Schema + typed DB client (in progress)

## Last session summary
[PASTE HANDOFF DOC HERE AT THE START OF EVERY SESSION]
