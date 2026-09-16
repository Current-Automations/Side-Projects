/**
 * lib/pricing/pokemonpricetracker.ts
 *
 * PricingProvider stub for pokemonpricetracker.com — TCGPlayer/eBay daily
 * prices, and PSA 8/9/10 graded values sourced from eBay completed listings
 * (useful for the graded-slab benchmark frames). Second choice from the
 * 2026-09-14 comping decision, see Q7 in
 * Atlas/Brainstorms/2026-09-14-cardsnap-roadmap-to-revenue.md.
 *
 * STUB, NOT VERIFIED: pokemonpricetracker.com/docs is a client-rendered page
 * that couldn't be read without a JS-executing fetch, so the request/response
 * shape below is UNCONFIRMED — do not trust it without checking a real
 * response first.
 *
 * Once signed up (free tier: 100 credits/day, no card required):
 * 1. Add POKEMONPRICETRACKER_KEY to .env.local.
 * 2. Hit the card-details endpoint once manually with a known card to see the
 *    real request params and response field names (raw vs. graded prices).
 * 3. Fix BASE_URL, the query params, and the response mapping below to match.
 * 4. Remove the PROVIDER_UNAVAILABLE throw.
 */

import { PricingError, PRICING_ERROR } from '@/lib/types/pricing';
import type { PricingProvider } from './provider';
import type { PricingResult } from '@/lib/types/domain';

export const pokemonPriceTrackerProvider: PricingProvider = {
  source: 'pokemonpricetracker',

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async searchSoldListings(_query: string): Promise<PricingResult> {
    throw new PricingError(
      PRICING_ERROR.PROVIDER_UNAVAILABLE,
      'pokemonpricetracker.com not wired up yet — sign up for a free-tier key and verify the ' +
        'real request/response shape before implementing (see file header).'
    );
  },
};
