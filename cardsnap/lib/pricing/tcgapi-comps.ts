/**
 * lib/pricing/tcgapi-comps.ts
 *
 * PricingProvider stub for tcgapi.net's /v1/comps endpoint — real eBay sold
 * comps (not asking prices), the first choice from the 2026-09-14 comping
 * decision (see Atlas/Brainstorms/2026-09-14-cardsnap-roadmap-to-revenue.md, Q7).
 *
 * STUB, NOT VERIFIED: tcgapi.net's own /docs page 404s and no API reference
 * could be fetched, so the request/response shape below is UNCONFIRMED —
 * do not trust it without checking against a real response first.
 *
 * Once signed up (tcgapi.net -> Get API Key):
 * 1. Add TCGAPI_KEY to .env.local.
 * 2. Hit /v1/comps once manually (curl or the site's Explorer) with a known
 *    card to see the real request params and response field names.
 * 3. Fix BASE_URL, the query params, and the response mapping below to match.
 * 4. Remove the PROVIDER_UNAVAILABLE throw.
 */

import { PricingError, PRICING_ERROR } from '@/lib/types/pricing';
import type { PricingProvider } from './provider';
import type { PricingResult } from '@/lib/types/domain';

export const tcgapiCompsProvider: PricingProvider = {
  source: 'tcgapi-comps',

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async searchSoldListings(_query: string): Promise<PricingResult> {
    throw new PricingError(
      PRICING_ERROR.PROVIDER_UNAVAILABLE,
      'tcgapi.net /v1/comps not wired up yet — sign up for a key at tcgapi.net and verify the ' +
        'real request/response shape before implementing (see file header).'
    );
  },
};
