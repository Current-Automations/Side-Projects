/**
 * lib/pricing/catalog-snapshot.ts
 *
 * Free fallback price: the TCGplayer market price TCGdex ships with each card,
 * copied into catalog_cards.tcgplayer_prices at ingest. No API credits, no
 * network call, but only as fresh as the last catalog ingest, so the
 * attribution carries the snapshot date.
 */

import type { CatalogCardRow } from '@/lib/catalog';
import type { PricingResult } from '@/lib/types/domain';
import type { PriceLookup } from './provider';

type Variant = { marketPrice?: number | null; midPrice?: number | null };

const FINISH_WORDS: Record<PriceLookup['finish'], string[]> = {
  normal: ['normal'],
  holo: ['holofoil'],
  reverse: ['reverse'],
  first_edition: ['1st'],
  unlimited: ['unlimited'],
  promo: [],
};

export function catalogSnapshotPrice(
  card: CatalogCardRow,
  finish: PriceLookup['finish']
): PricingResult | null {
  const prices = card.tcgplayer_prices as Record<string, unknown> | null;
  if (!prices) return null;

  const variants = Object.entries(prices).filter(
    (e): e is [string, Variant] =>
      typeof e[1] === 'object' && e[1] !== null && typeof (e[1] as Variant).marketPrice === 'number'
  );
  if (variants.length === 0) return null;

  const words = FINISH_WORDS[finish];
  const wanted = variants.find(([name]) => {
    const n = name.toLowerCase().replace(/-/g, ' ');
    return words.length > 0 && words.every((w) => n.includes(w)) && (finish !== 'holo' || !n.includes('reverse'));
  });
  // Only one printing on file means the finish question doesn't arise.
  const [printing, v] = wanted ?? (variants.length === 1 ? variants[0] : []);
  if (!printing || !v) return null;

  const updated = typeof prices.updated === 'string' ? prices.updated : null;
  const asOf = updated ? updated.slice(0, 10) : 'unknown date';
  return {
    avg_sold_price: v.marketPrice as number,
    last_10_sales: [],
    sample_size: 0,
    fetched_at: updated ?? new Date().toISOString(),
    attribution: `TCGplayer market price, saved ${asOf} (${printing})`,
  };
}
