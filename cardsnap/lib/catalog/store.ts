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

/** "122/172" -> "122", "036" -> "36", "GG70" -> "gg70": the part printed before the slash. */
function numberKey(n: string): string {
  const first = n.split('/')[0].trim().toLowerCase();
  return /^\d+$/.test(first) ? String(parseInt(first, 10)) : first;
}

/** "061/128" -> 128: the printed set size after the slash, if any. */
function printedTotal(n: string | undefined): number | null {
  const m = n?.match(/\/\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function scoreMatch(
  card: CatalogCardRow,
  params: { card_name: string; set_id?: string; card_number?: string },
  setSizes: Map<string, number | null>
): number {
  let score = 0;
  if (normalize(card.name) === normalize(params.card_name)) score += 3;
  else if (normalize(card.name).includes(normalize(params.card_name))) score += 1;
  // The printed "/128" names the set even when the model has never heard of it
  // (sets newer than its training), so it counts the same as a correct set id.
  const total = printedTotal(params.card_number);
  const sameSize = total !== null && setSizes.get(card.set_id) === total;
  if ((params.set_id && card.set_id === params.set_id) || sameSize) score += 2;
  if (params.card_number && numberKey(card.local_id) === numberKey(params.card_number)) score += 2;
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
}): Promise<CatalogDbResult<{ card: CatalogCardRow; match_confidence: number; printings: number } | null>> {
  try {
    const db = getServerClient();

    // The model's set_id is often wrong or malformed ("swsH"), so it only scores,
    // never filters. A readable number narrows the query first, because common
    // names (Pikachu) have more printings than any sane limit.
    const byName = () => db.from('catalog_cards').select('*').ilike('name', `%${params.card_name}%`);
    let rows: CatalogCardRow[] = [];
    if (params.card_number) {
      const key = numberKey(params.card_number);
      const ids = /^\d+$/.test(key) ? [key, key.padStart(2, '0'), key.padStart(3, '0')] : [params.card_number.split('/')[0].trim()];
      const { data, error } = await byName().in('local_id', [...new Set(ids)]).limit(50);
      if (error) return { success: false, error: error.message };
      rows = (data ?? []) as CatalogCardRow[];
    }
    if (rows.length === 0) {
      const { data, error } = await byName().limit(100);
      if (error) return { success: false, error: error.message };
      rows = (data ?? []) as CatalogCardRow[];
    }
    if (rows.length === 0) return { success: true, data: null };

    const setSizes = new Map<string, number | null>();
    if (printedTotal(params.card_number) !== null) {
      const { data: sets } = await db
        .from('catalog_sets')
        .select('id, card_count_official')
        .in('id', [...new Set(rows.map((r) => r.set_id))]);
      for (const s of (sets ?? []) as { id: string; card_count_official: number | null }[]) {
        setSizes.set(s.id, s.card_count_official);
      }
    }

    const scored = rows
      .map((card) => ({ card, score: scoreMatch(card, params, setSizes) }))
      .sort((a, b) => b.score - a.score);
    const [best, runnerUp] = scored;

    // Max possible score is 7 (name exact + set_id + card_number), require >= 3
    if (best.score < 3) return { success: true, data: null };

    // Two printings scoring the same (same name + number in two sets) is a coin flip, not a match.
    const tied = runnerUp !== undefined && runnerUp.score === best.score;
    const printings = rows.filter((r) => normalize(r.name) === normalize(params.card_name)).length;
    let match_confidence = tied ? Math.min(best.score / 7, 0.5) : best.score / 7;
    // Name alone is enough when the catalog holds only one card by that name (Appletun V).
    if (best.score === 3 && printings === 1) match_confidence = 0.8;

    return { success: true, data: { card: best.card, match_confidence, printings } };
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

export async function getSetName(setId: string): Promise<string | null> {
  const { data } = await getServerClient().from('catalog_sets').select('name').eq('id', setId).maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}

/** Anniversary reprint sets: same art and printed number as the original, plus a logo stamp. */
const REPRINT_SETS = ['30th-c', 'cel25cc'];

export async function findStampedReprint(name: string, notSetId: string): Promise<string | null> {
  if (REPRINT_SETS.includes(notSetId)) return null;
  const { data } = await getServerClient()
    .from('catalog_cards')
    .select('local_id, catalog_sets(name)')
    .eq('name', name)
    .in('set_id', REPRINT_SETS)
    .limit(1)
    .maybeSingle();
  const row = data as { local_id: string; catalog_sets: { name: string } | null } | null;
  return row ? `${row.catalog_sets?.name ?? 'Classic Collection'} #${row.local_id}` : null;
}
