/**
 * lib/catalog/store.ts
 *
 * Store-backed catalog queries — reads from catalog_cards / catalog_sets
 * (migration 002_pokemon_catalog.sql), populated by scripts/ingest-catalog.ts.
 * Fuzzy matching is scored locally after a broad DB query, same approach as
 * the old lib/db/cards.ts findCard() this replaces.
 */
import { getServerClient } from '@/lib/db/server-client';
import type { CatalogCardRow } from './transform';

export type CatalogDbResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '');
}

function scoreMatch(
  card: CatalogCardRow,
  params: { card_name: string; set_id?: string; card_number?: string }
): number {
  let score = 0;
  if (normalize(card.name) === normalize(params.card_name)) score += 3;
  else if (normalize(card.name).includes(normalize(params.card_name))) score += 1;
  if (params.set_id && card.set_id === params.set_id) score += 2;
  if (params.card_number && card.local_id === params.card_number) score += 2;
  return score;
}

/**
 * Fuzzy catalog lookup. Returns the best match (score >= 3) or null.
 * Also returns match_confidence (0-1) for the caller to decide whether to
 * ask the user to confirm.
 */
export async function findCatalogCard(params: {
  card_name: string;
  set_id?: string;
  card_number?: string;
}): Promise<CatalogDbResult<{ card: CatalogCardRow; match_confidence: number } | null>> {
  try {
    const db = getServerClient();

    let query = db.from('catalog_cards').select('*').ilike('name', `%${params.card_name}%`).limit(20);
    if (params.set_id) {
      query = query.eq('set_id', params.set_id);
    }

    const { data, error } = await query;
    if (error) return { success: false, error: error.message };
    if (!data || data.length === 0) return { success: true, data: null };

    const scored = (data as CatalogCardRow[]).map((card) => ({
      card,
      score: scoreMatch(card, params),
    }));

    const best = scored.sort((a, b) => b.score - a.score)[0];

    // Max possible score is 7 (name exact + set_id + card_number), require >= 3
    const match_confidence = best.score / 7;

    if (best.score < 3) return { success: true, data: null };

    return { success: true, data: { card: best.card, match_confidence } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function getCatalogCardById(id: string): Promise<CatalogDbResult<CatalogCardRow | null>> {
  try {
    const db = getServerClient();
    const { data, error } = await db.from('catalog_cards').select('*').eq('id', id).maybeSingle();

    if (error) return { success: false, error: error.message };
    return { success: true, data: data as CatalogCardRow | null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
