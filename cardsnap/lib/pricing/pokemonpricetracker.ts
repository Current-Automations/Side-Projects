/**
 * lib/pricing/pokemonpricetracker.ts
 *
 * PricingProvider for pokemonpricetracker.com (API v2). Returns the TCGplayer
 * market price for the exact printing, not eBay sold listings, so
 * last_10_sales is always empty and the attribution says so.
 *
 * Verified against live responses 2026-09-25 (free tier):
 * - Credits are charged per result *requested* (limit), not per result returned.
 *   Free tier is 100/day, so every lookup keeps limit as small as possible.
 * - `search=<tcgdex id>` (e.g. "sv03-125") returns that card first, and each
 *   result carries `externalCatalogId` = the TCGdex id, so a known catalog card
 *   costs 1 credit and is matched exactly.
 * - Without an id, `search=<name>&set=<set name>` narrows well; the result is
 *   only trusted when name and collector number both match.
 * - Graded (PSA) prices need includeEbay (+1 credit per card), not wired yet.
 */

import { z } from 'zod';
import { PricingError, PRICING_ERROR } from '@/lib/types/pricing';
import type { PriceLookup, PricingProvider } from './provider';
import type { PricingResult } from '@/lib/types/domain';

const BASE_URL = 'https://www.pokemonpricetracker.com/api/v2/cards';

const VariantSchema = z.object({
  marketPrice: z.number().nullable().optional(),
});

const CardSchema = z.object({
  name: z.string(),
  setName: z.string().nullable().optional(),
  cardNumber: z.string().nullable().optional(),
  externalCatalogId: z.string().nullable().optional(),
  prices: z
    .object({
      market: z.number().nullable().optional(),
      primaryPrinting: z.string().nullable().optional(),
      lastUpdated: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  variants: z.record(z.string(), VariantSchema).nullable().optional(),
});

const ResponseSchema = z.object({ data: z.array(CardSchema) });

type PptCard = z.infer<typeof CardSchema>;

/** Our finish enum -> words in PPT printing names ("Holofoil", "Reverse Holofoil", "1st Edition Holofoil"). */
const FINISH_WORDS: Record<PriceLookup['finish'], string[]> = {
  normal: ['normal'],
  holo: ['holofoil'],
  reverse: ['reverse'],
  first_edition: ['1st edition'],
  unlimited: ['unlimited'],
  promo: [],
};

function collectorNumber(n: string | null | undefined): number | null {
  const m = n?.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function pickCard(cards: PptCard[], card: PriceLookup): PptCard | null {
  if (card.tcgdex_id) {
    return cards.find((c) => c.externalCatalogId === card.tcgdex_id) ?? null;
  }
  const want = collectorNumber(card.card_number);
  const named = cards.filter((c) => sameName(c.name, card.card_name));
  if (want !== null) {
    return named.find((c) => collectorNumber(c.cardNumber) === want) ?? null;
  }
  // No number to check: only trust a name match that is the sole candidate.
  return named.length === 1 ? named[0] : null;
}

export function pickPrice(c: PptCard, finish: PriceLookup['finish']): { price: number; printing: string } | null {
  const words = FINISH_WORDS[finish];
  const hit = Object.entries(c.variants ?? {}).find(([name]) => {
    const n = name.toLowerCase();
    // "holofoil" alone must not match "Reverse Holofoil".
    return words.length > 0 && words.every((w) => n.includes(w)) && (finish !== 'holo' || !n.includes('reverse'));
  });
  if (hit && hit[1].marketPrice != null) return { price: hit[1].marketPrice, printing: hit[0] };
  if (c.prices?.market != null) {
    return { price: c.prices.market, printing: c.prices.primaryPrinting ?? 'primary printing' };
  }
  return null;
}

export const pokemonPriceTrackerProvider: PricingProvider = {
  source: 'pokemonpricetracker',

  async searchSoldListings(_query: string, card?: PriceLookup): Promise<PricingResult> {
    const key = process.env.POKEMONPRICETRACKER_API_KEY;
    if (!key) {
      throw new PricingError(PRICING_ERROR.AUTH_FAILED, 'POKEMONPRICETRACKER_API_KEY is not set in .env.local');
    }
    if (!card) {
      throw new PricingError(PRICING_ERROR.NO_RESULTS, 'pokemonpricetracker needs the identified card, not a free-text query');
    }

    const params = new URLSearchParams();
    if (card.tcgdex_id) {
      params.set('search', card.tcgdex_id);
      params.set('limit', '1');
    } else {
      params.set('search', card.card_name);
      if (card.set_name) params.set('set', card.set_name);
      params.set('limit', '3');
    }

    const res = await fetch(`${BASE_URL}?${params}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new PricingError(PRICING_ERROR.AUTH_FAILED, `pokemonpricetracker rejected the key (HTTP ${res.status})`);
    }
    if (!res.ok) {
      const limit = res.status === 429 ? ' (daily or per-minute limit hit)' : '';
      throw new PricingError(PRICING_ERROR.REQUEST_FAILED, `pokemonpricetracker HTTP ${res.status}${limit}`);
    }

    const parsed = ResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new PricingError(
        PRICING_ERROR.VALIDATION_FAILED,
        `pokemonpricetracker response shape changed: ${parsed.error.message}`
      );
    }

    const match = pickCard(parsed.data.data, card);
    if (!match) {
      const wanted = card.tcgdex_id ?? `${card.card_name} ${card.card_number ?? ''}`.trim();
      throw new PricingError(PRICING_ERROR.NO_RESULTS, `pokemonpricetracker: no exact match for ${wanted}`);
    }

    const priced = pickPrice(match, card.finish);
    if (!priced) {
      throw new PricingError(
        PRICING_ERROR.NO_RESULTS,
        `pokemonpricetracker has no market price for ${match.name} (${match.setName ?? 'unknown set'})`
      );
    }

    const graded = card.is_graded ? ', raw price, grade not priced' : '';
    return {
      avg_sold_price: priced.price,
      last_10_sales: [],
      sample_size: 0,
      fetched_at: match.prices?.lastUpdated ?? new Date().toISOString(),
      attribution: `TCGplayer market price via PokemonPriceTracker (${priced.printing}${graded})`,
    };
  },
};
