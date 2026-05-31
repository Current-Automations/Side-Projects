# Drinking & Thinking Trivia — v2: Deep Pools, Subcategories, Presets

**Date:** 2026-05-30
**Status:** Draft — awaiting review
**Builds on:** `2026-05-30-trivia-app-design.md`

---

## Overview

v1 shipped a working host game with fixed 5-question categories. v2 turns each category into a deep **pool** (~20 questions), draws a fresh board every game, adds **subcategories** with setup-time filtering, and adds **presets** for fast game setup. The goal is replayability — same categories, different board every night — and balance across 10 distinct categories (6 sports, 4 non-sports).

No change to the in-game flow (board → overlay → scoring → end). All changes are in **question data**, **board generation**, the **setup screen**, and the **editor**.

---

## Data Model Changes

A question gains one optional field:

```json
{ "id": "mtv-anime-1", "value": 200, "question": "...", "answer": "...", "subcategory": "Anime" }
```

- `subcategory` (optional string) — groups questions within a category (e.g. Movies & TV → `Movie`/`TV`/`Anime`; Music → `Rock`/`Pop`/`Rap`). Absent = ungrouped.
- A category now holds a **pool** of ~20 questions, meaning **multiple questions per value tier** (≈4 each at 200/400/600/800/1000).

The 10 categories: NFL, NBA, MLB, NHL, College Football, College Basketball, Video Games, Movies & TV, Music, General Knowledge.

---

## Board Generation (the core change)

At **game start**, for each selected category, build the 5-cell column by drawing one question per value tier:

```
for each selected category C (optionally filtered to chosen subcategories):
  for each value V in [200,400,600,800,1000]:
    candidates = C.questions where value == V and (no sub-filter OR subcategory in chosen subs)
    pick one at random  ->  that question fills the (C, V) cell
    if candidates is empty -> cell renders as an unavailable/blank slot
```

- Selection happens once per game; the chosen question for each cell is fixed for that game.
- Randomness varies the board game-to-game. (No seeded RNG needed; `Math.random` in the browser is fine — this is client-side game setup, not the workflow sandbox.)
- A pool thinner than one-per-tier just yields some blank cells; the `_fill` notes in staging track which categories need more.

This replaces v1's `c.questions.find(x => x.value === value)` (always-first) with a random pick from the tier's candidates.

---

## Setup Screen Changes

### Presets (new — top of setup)
Three buttons that pre-select categories, then drop into the normal setup:

- **Sports** — selects all 6 sports categories (NFL, NBA, MLB, NHL, College Football, College Basketball).
- **Random** — selects 6 random categories from the 10.
- **Custom** — selects nothing; host checks the categories they want.

All three then use the random board draw. Default board is 6 columns; the grid already scales to any N, so Custom can pick fewer or more.

### Subcategory filters (new)
For any selected category that has subcategories, show a small set of checkboxes (e.g. Movies & TV → ☑ Movie ☑ TV ☑ Anime). All checked by default. Unchecking narrows the draw pool for that category. This is how the host runs "anime-only" or "just movies" or a mix.

### Unchanged
Player names (2–8), Classic/No-Gain mode, first-player pick, Start Game.

---

## Editor Changes

- Each question row gains an optional **subcategory** input (free text or datalist of existing subs in that category).
- Saving still writes the whole `questions.json` via `PUT /api/questions` and regenerates `answers.txt`.
- `answers.txt` generation includes the subcategory tag where present.

---

## Closest-Wins Questions

Some questions (e.g. "how many times is 'black' said in the song — closest wins") are judged by the host picking the nearest guess. **No code needed** — the host already decides Correct/Incorrect manually. Convention only: word the question with "(closest guess wins)".

---

## Data Migration

The vetted, calibrated bank from `staging-questions.json` replaces the v1 seed in `app/questions.json`, after:
1. Jarrett's keep/cut pass on staging.
2. Calibration pass (clue specificity scales with value — tells at the bottom, bare at the top).
3. Strip the `note`/`_fill`/`_README`/`_status` helper fields.

---

## Out of Scope (still)

- Contestant/player devices, buzz-in, real-time sync.
- Per-sport subcategories (the tag supports it, but only Movies & TV and Music use it now).
- Auto-balancing pools to exactly 4-per-tier (manual via editor + staging `_fill` notes).

---

## Build Order (for the plan)

1. Board random-draw from pools (game.js / host.js) — the engine change.
2. `subcategory` field end to end (data + editor input + answers.txt).
3. Setup subcategory filter UI.
4. Preset buttons (Sports / Random / Custom).
5. Migrate vetted bank into `questions.json`.
