# CardSnap identification benchmark

The permanent regression benchmark for card identification. Every identifier
change (GPT-4o baseline, retrieval stage 1, finish resolution stage 2, Scrydex
fallback) is scored against the same fixture set so we can see whether a change
actually helped.

See the rebuild plan (Phase 0.4) for why this exists: the premise "GPT-4o isn't
good enough for Pokémon" had never been measured.

## Fixture set

Two source distributions, scored separately:

- **`single-hold`** — a seller holding one card up, steady or slowly rotated
  under lights. Clean input. The v1 target scenario.
- **`pack-break`** — cards flashing by fast during a pack opening. Angled, in
  motion, sometimes several on screen. The hard distribution.

### Adding frames

1. Drop image files (or short bursts — several frames of the same card) into
   `benchmark/frames/`. JPG or PNG. Name them however; the label file references
   them by filename.
2. Add one entry per frame to `benchmark/labels.json` (copy the shape from
   `labels.example.json`):

   ```json
   {
     "file": "sv3-charizard-ex-alt-01.jpg",
     "distribution": "single-hold",
     "set_id": "sv03",
     "set_name": "Obsidian Flames",
     "card_name": "Charizard ex",
     "card_number": "223",
     "finish": "holo",
     "notes": "special illustration rare, alt art"
   }
   ```

   `finish` is one of: `normal`, `holo`, `reverse`, `first_edition`,
   `unlimited`, `promo`. Use the physically correct one, not the rarity.

3. Aim for ~30 per distribution, with variety: plain cards, reverse holos, an
   alt art, a secret/gold rare, a graded slab or two.

Ground truth is whatever the seller says on stream plus a check against
pokemon.com / the TCGdex catalog. The crowd game never overrides these labels.

## Running

```
OPENAI_API_KEY must be set (or present in .env.local)

node benchmark/run.mjs                 # default model gpt-4o
node benchmark/run.mjs --model gpt-4o-mini
node benchmark/run.mjs --limit 10      # smoke test on the first 10
```

Output:

- A summary table to stdout — accuracy on three tiers (card name / set / finish),
  split by distribution and overall.
- `benchmark/results/<ISO-timestamp>.json` — per-frame results plus the summary,
  committed so the series is visible over time.

## Tiers

- **card** — did it name the Pokémon / card title
- **set** — did it name the correct set
- **finish** — did it get the physical finish right (the expensive tier; this is
  the one the catalog can't resolve and the shop game's Mode B feeds)
