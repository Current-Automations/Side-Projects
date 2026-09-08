/**
 * lib/game/rounds.ts
 *
 * Round construction. Pure: takes a raw draw from the store, returns the
 * question the browser sees plus the correct answer (kept separate so the
 * route never leaks it into the response).
 *
 * v1 ships Mode A only ("which set"). It is also the label source for the
 * hardest problem from the Phase 2 grill-me: set disambiguation. Mode B
 * ("which version") needs per-finish images or break frames, which do not
 * exist yet, so it is reserved in the schema and built alongside Phase 2/4.
 */
import type { RawSetDraw } from './store';
import type { GameMode } from './schemas';

export type Pool = 'control' | 'hard' | 'unknown';

/** Target mix from the plan. Only 'control' has data in v1. */
const POOL_WEIGHTS: Record<Pool, number> = { control: 0.6, hard: 0.25, unknown: 0.15 };

/**
 * Pick a pool by weight, restricted to pools that currently have cards.
 * Until the benchmark (hard) and break frames (unknown) exist, this always
 * returns 'control'.
 */
export function pickPool(available: Pool[] = ['control']): Pool {
  const pools = (Object.keys(POOL_WEIGHTS) as Pool[]).filter((p) => available.includes(p));
  if (pools.length === 0) return 'control';
  const total = pools.reduce((s, p) => s + POOL_WEIGHTS[p], 0);
  let r = Math.random() * total;
  for (const p of pools) {
    r -= POOL_WEIGHTS[p];
    if (r <= 0) return p;
  }
  return pools[pools.length - 1];
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface BuiltRound {
  cardId: string | null;
  mode: GameMode;
  prompt: string;
  imagePath: string;
  choices: string[];
  correct: string;
}

/** Mode A: show the card, ask which set it is from. */
export function buildSetRound(draw: RawSetDraw): BuiltRound {
  const distractors = draw.distractor_sets.filter((s) => s && s !== draw.set_name);
  const unique = Array.from(new Set([draw.set_name, ...distractors]));
  const choices = shuffle(unique).slice(0, 4);
  // Guarantee the answer survived the slice.
  if (!choices.includes(draw.set_name)) {
    choices[Math.floor(Math.random() * choices.length)] = draw.set_name;
  }
  return {
    cardId: draw.card_id,
    mode: 'set',
    prompt: 'Which set is this card from?',
    imagePath: draw.image_path,
    choices,
    correct: draw.set_name,
  };
}
