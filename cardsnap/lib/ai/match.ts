/**
 * lib/ai/match.ts
 *
 * Maps a GPT-4o CardIdentification onto a catalog card by fuzzy match against
 * catalog_cards, and surfaces a needsConfirmation flag when the match is too
 * weak to trust. The price-cache fingerprint is keyed on the matched catalog
 * card, not the model's raw read: the model's set and number vary from scan to
 * scan of the same card, and a cache hit keyed on them used to return a price
 * with no card attached.
 */

import { findCatalogCard } from '@/lib/catalog';
import { generateFingerprint } from '@/lib/db';
import type { CardIdentification } from '@/lib/types/identification';
import type { CatalogCardRow } from '@/lib/catalog';

/** Below this match confidence, ask the user to confirm rather than trust the match. */
const MATCH_CONFIRMATION_THRESHOLD = 0.6;

export interface CardMatch {
  /** Deterministic hash of the matched card + finish + grade — the price cache key. */
  fingerprint: string;
  /** Best catalog match, or null when nothing in the catalog matched. */
  card: CatalogCardRow | null;
  matchConfidence: number;
  needsConfirmation: boolean;
  /** Catalog cards carrying the read name exactly; more than one means the name alone can't say which. */
  printings: number;
}

export type MatchResult =
  | { success: true; data: CardMatch }
  | { success: false; error: string };

export async function match(identification: CardIdentification): Promise<MatchResult> {
  const found = await findCatalogCard({
    card_name: identification.card_name,
    set_id: identification.set_id,
    card_number: identification.card_number,
  });
  if (!found.success) {
    return { success: false, error: `match (catalog lookup): ${found.error}` };
  }

  const card = found.data?.card ?? null;
  const fingerprint = generateFingerprint({
    card_name: card?.name ?? identification.card_name,
    set_id: card?.set_id ?? identification.set_id ?? null,
    card_number: card?.local_id ?? identification.card_number ?? null,
    finish: identification.finish,
    grade_company: identification.grade_company ?? null,
    grade_value: identification.grade_value ?? null,
  });

  if (!found.data) {
    // Nothing in the catalog matched — caller should confirm before trusting.
    return {
      success: true,
      data: { fingerprint, card: null, matchConfidence: 0, needsConfirmation: true, printings: 0 },
    };
  }

  const { match_confidence, printings } = found.data;
  return {
    success: true,
    data: {
      fingerprint,
      card,
      matchConfidence: match_confidence,
      needsConfirmation: match_confidence < MATCH_CONFIRMATION_THRESHOLD,
      printings,
    },
  };
}
