/**
 * lib/ai/match.ts
 *
 * Maps a GPT-4o CardIdentification onto a catalog card. Checks the price cache
 * by fingerprint first (a hit means we already know this exact card and can
 * skip the catalog lookup), then falls back to a fuzzy match against the cards
 * table. Surfaces a needsConfirmation flag when the match is too weak to trust.
 *
 * Field-name bridge: the AI/domain shape uses product_line + parallel_name,
 * while the db helpers speak set_name + parallel. The mapping lives here.
 */

import { findCard, generateFingerprint, getCachedPrice } from '@/lib/db';
import type { CardIdentification } from '@/lib/types/identification';
import type { Card } from '@/lib/types/db';

/** Below this match confidence, ask the user to confirm rather than trust the match. */
const MATCH_CONFIRMATION_THRESHOLD = 0.6;

export interface CardMatch {
  /** Deterministic hash of the identified card + grade — the price cache key. */
  fingerprint: string;
  cacheHit: boolean;
  /** Best catalog match, or null when nothing in the catalog matched. */
  card: Card | null;
  matchConfidence: number;
  needsConfirmation: boolean;
}

export type MatchResult =
  | { success: true; data: CardMatch }
  | { success: false; error: string };

export async function match(identification: CardIdentification): Promise<MatchResult> {
  const fingerprint = generateFingerprint({
    player_name: identification.player_name,
    year: identification.year,
    manufacturer: identification.manufacturer,
    set_name: identification.product_line,
    parallel: identification.parallel_name,
    grade_company: identification.grade_company ?? null,
    grade_value: identification.grade_value ?? null,
  });

  // 1. Price cache first — a hit means this exact card+grade was priced recently.
  const cached = await getCachedPrice(fingerprint);
  if (!cached.success) {
    return { success: false, error: `match (cache lookup): ${cached.error}` };
  }
  if (cached.data) {
    console.log(`[match] cache HIT fingerprint=${fingerprint.slice(0, 12)}`);
    return {
      success: true,
      data: {
        fingerprint,
        cacheHit: true,
        card: null,
        matchConfidence: 1,
        needsConfirmation: false,
      },
    };
  }
  console.log(`[match] cache MISS fingerprint=${fingerprint.slice(0, 12)}`);

  // 2. No cache — fuzzy match against the catalog.
  const found = await findCard({
    player_name: identification.player_name,
    year: identification.year,
    manufacturer: identification.manufacturer,
    set_name: identification.product_line,
    parallel: identification.parallel_name,
  });
  if (!found.success) {
    return { success: false, error: `match (catalog lookup): ${found.error}` };
  }

  if (!found.data) {
    // Nothing in the catalog matched — caller should confirm before trusting.
    return {
      success: true,
      data: {
        fingerprint,
        cacheHit: false,
        card: null,
        matchConfidence: 0,
        needsConfirmation: true,
      },
    };
  }

  const { card, match_confidence } = found.data;
  return {
    success: true,
    data: {
      fingerprint,
      cacheHit: false,
      card,
      matchConfidence: match_confidence,
      needsConfirmation: match_confidence < MATCH_CONFIRMATION_THRESHOLD,
    },
  };
}
