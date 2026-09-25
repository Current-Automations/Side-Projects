# Benchmark capture notes — 2026-09-08 session

Seven OBS screen-recordings of live Whatnot streams, recorded ~00:21–00:27.
Raw clips in `C:\Users\Jarre\Videos\2026-09-08 00-*.mp4` (not committed).
Frames pulled at 2 fps into `benchmark/frames/` as `c<clip>-<seq>.jpg`.
Contact sheets (1 fps, straight from the video) in `benchmark/_raw/sheets/`.

## What each clip holds

| clip | file (00-…) | len | seller / listing | cards | distribution |
|---|---|---|---|---|---|
| c1 | 21-20 | 16s | "Apex Origins Vintage" | OBS setup for ~4s, then a hand holding one **PSA slab**, vintage holo, rotated | single-hold, slab |
| c2 | 22-00 | 15s | Apex Origins (same cam) | PSA slabs, held up | single-hold, slab |
| c3 | 22-45 | 21s | Apex Origins — "3x SHATTERED SLABS / SINGLE SLAB (RIP ONLY)" | stack of PSA slabs, individual **graded vintage holos** held and turned (a green/yellow one, an orange one) | single-hold, slab |
| c4 | 23-50 | 44s | "WOTC ERA HEAVY" seller, binder behind | one **raw English Charizard**, Base-Set-era art, slow rotation. The clean case for our identifier. | single-hold, raw, EN |
| c5 | 24-37 | 7s | (short, not reviewed) | — | — |
| c6 | 25-09 | 12s | (short, not reviewed) | — | — |
| c7 | 25-37 | 92s | **goatedsnipes** — "RAPID FIRE $2 START Singles & Packs" | raw **Chinese Rayquaza** (holo, 220 HP), a **Charizard** with a circular Pokéball stamp, then a Pikachu figure + a small card in a toploader. Held and rotated. | single-hold, raw, **non-EN** |

## Gaps to fill later

- **No real pack-break footage.** Everything here is single-hold (someone holding one
  card or slab up). The `pack-break` half of the fixture set still needs a capture of
  an actual rip, cards in motion, several on screen.
- **Scope mismatch on most of it.** c1/c2/c3 are graded slabs; c7 is Chinese. Our v1
  identifier is English raw Kanto. These frames are still worth scoring GPT-4o on (they
  are the honest real-world input), but tag the out-of-scope ones so Stage 1 retrieval
  is not judged on them:
  - add `"in_catalog": false` to slab and non-English entries
- **English raw singles** are underrepresented (only c4). The singles-selling friend's
  stream, when it happens, is the priority capture.

## Labeling

`labels.json` has starter rows with what was identifiable by sight; `set_id`,
`card_number` and `finish` are `"TODO"`. Fill them from what the seller says on the
clip audio plus a check on pokemon.com / tcgdex.net. Cull `benchmark/frames/` to the
frames you actually label (aim ~30 single-hold to start; keep 3–5 per card as a burst
so the Stage 2 finish work has motion). Then `node benchmark/run.mjs`.

## 2026-09-14 — culled to `benchmark/frames/` (33 frames, 8 cards)

Cropped every kept frame to the Whatnot video-player region only
(`crop=924:812:492:204` on the raw 1920x1080 capture) — drops the shop panel
(left) and chat panel (right), matching what the extension will actually see
from a stream tab.

| burst | card | source | notes |
|---|---|---|---|
| `c1c2-latias-ex-slab-0N` (8) | Latias EX (Delta Species) | c1+c2, spacenarwhalz | PSA slab |
| `c3-ninetales-slab-0N` (3) | Ninetales (JP) | c3, spacenarwhalz | PSA slab, non-English |
| `c4-lopunny-0N` (4) | Lopunny | c4, streetsmart | raw, out of Kanto scope |
| `c5-ralts-delta-0N` (4) | Ralts (Fire Delta) | c5, streetsmart | raw |
| `c6-naveen-0N` (4) | Naveen (Supporter) | c6, texas830jc | card mounted in a stand, not hand-held -- different capture condition |
| `c7-rayquaza-0N` (4) | Rayquaza EX | c7, goatedsnipes | raw |
| `c7-beedrill-ex-jumbo-0N` (3) | Beedrill EX (jumbo) | c7, goatedsnipes | oversized promo, non-English packaging |
| `c7-unidentified-red-cn-0N` (3) | TODO | c7, goatedsnipes | Chinese, red/fire creature, still needs ID |

**Corrections to this file's earlier per-clip table:** c3's slabs are a
Latias EX (c1/c2) and a Ninetales (c3), not identified there. c7's "Chinese
Rayquaza" is actually **English** (attack text "Breakthrough Assault"/"Dragon
Claw" is legible) -- fixed in `labels.json`. The c7 "Jumbo Ice Cream" entry
was a misread of the packaging art; the card itself is a jumbo **Beedrill
EX**. The c7 "Charizard with a Pokéball stamp" does not match Charizard's
silhouette (no wings) -- relabeled `TODO`, still unidentified.

**Dropped:** an attempted `c3-shattered-slab-a` burst (frames 10/14/18) turned
out to be the seller unwrapping the slab bag with no card visible in any of
the three frames -- not used.

**Still not identified:** exact `set_id`/`card_number` for all 8 cards (needs
the pokemon.com/tcgdex.net check per the Labeling section above), and the
c7 red Chinese card's identity entirely. No pack-break footage still.

Raw dump/contact sheets stay local only (`benchmark/_raw/`, now gitignored) --
only `benchmark/frames/` + `labels.json` are meant to be committed.

## 2026-09-17 — `autotrim.py`: auto-cut raw recordings to card-visible spans

New script, `benchmark/two-stage/autotrim.py`, plus a small refactor pulling the
OWLv2 detector out of `detect_crop.py` into `benchmark/two-stage/card_detect.py`
so both scripts share it. Point it at a raw OBS `.mp4`; it crops to the Whatnot
player region, samples at 2fps, runs the same zero-shot card detector, and
writes a manifest of card-visible spans (start/end/score) instead of a video
to scrub by eye. `--sheet` writes a contact-sheet montage per span for a fast
visual review; `--extract` writes frames from kept spans in the existing
`c<clip>-<seq>.jpg` naming. Manifests and frames land in `_work/autotrim/`
(gitignored, same as everything else touching third-party stream content).

Also fixed while wiring this up: the installed `transformers` renamed
`Owlv2Processor.post_process_object_detection` to
`post_process_grounded_object_detection`. `detect_crop.py` was broken by this
independent of anything here; both scripts now use the renamed method via
`card_detect.py`.

Ran against all 9 existing raw clips (the 7 from 2026-09-08, both from
2026-09-16) as a smoke test before recording more sellers:

- **The fixed crop (`crop=924:812:492:204`) holds on a 6th distinct seller**
  ("immaculate", 2026-09-16), not just the ~5 from 2026-09-08.
- **c1's ~4s OBS-setup opening gets dropped** (kept span starts at 3.0s), matching
  the per-clip table above.
- **c3's bag-unwrapping stretch gets dropped** — a real ~7.5s gap with nothing
  scored as a card in it, matching "the seller unwrapping the slab bag with no
  card visible" from the dropped-burst note above.
- **c4's 44s Charizard rotation stays one span**, not fragmented.
- **Found a false-positive mode**: at the default 0.15 score floor (same floor
  `detect_crop.py` always used), c3 kept a spurious 3s span before the real
  gap — it was the streamer's small facecam bubble matching "a trading card in
  a plastic case" on aspect ratio, not an actual card, scored 0.17-0.19. Added
  `--min-score` (default 0.15, unchanged); at `--min-score 0.25` the spurious
  span disappears and only the genuine slab-hold span remains. Worth using
  0.2-0.25 by default once run on real footage instead of the raw floor.
- **c7's several held items (Rayquaza, stamped Charizard, Pikachu figure +
  toploader) do not split into separate spans** — the clip stays ~99% one
  continuous span. That's correct for a presence detector (something
  card-shaped stayed in frame the whole time), it just means "did the held
  item change" is not something auto-trim answers; that's still the
  identifier's job downstream.
- Overall on this corpus: 208s total, 193s kept (~93%). That's expected to be
  a weak signal — this footage was already hand-culled around known card
  holds, so of course most of it is a card. The real test is the first full
  unedited hour-long recording, where the manual-cull step has never touched
  it.

Not done here: no fine-tuning, no multi-card handling, no `.mp4` clip cutting,
no audio. All deferred per the 2026-09-17 grill session
(`Atlas/Brainstorms/Projects/CardSnap/2026-09-17-cardsnap-footage-autotrim.md`
in the vault).

## 2026-09-25 — Recording other sellers' streams stopped

Whatnot's terms bar "any manual process to monitor or copy any of the material
on the App" without their written consent, and any automated use or scraping.
So no more OBS recordings of other sellers, manual or automated, and the
15-20 seller plan above is dropped. The 9 clips already on disk stay local and
are used for testing only. New training footage is cards Jarrett owns, filmed
by him on his phone in several lighting and background setups. YouTube and
TikTok footage is out for the same reason (both terms bar downloading and
scrapers). Grill notes: `Atlas/Brainstorms/Projects/CardSnap/2026-09-25-cardsnap-data-shops-investors.md`
in the vault.
