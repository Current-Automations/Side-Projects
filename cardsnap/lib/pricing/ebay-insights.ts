/**
 * lib/pricing/ebay-insights.ts
 *
 * PricingProvider stub for the eBay Marketplace Insights API (true sold comps).
 *
 * This API requires eBay program approval before the endpoint returns data.
 * Apply at: https://developer.ebay.com/api-docs/buy/marketplace-insights/overview.html
 *
 * Once approved:
 * 1. Add EBAY_INSIGHTS_ENABLED=true to .env.local
 * 2. Switch getActiveProvider() in lib/pricing/index.ts to return this provider
 * 3. Implement searchSoldListings() against the real endpoint (soldItems/search)
 *
 * Until then, this always throws PROVIDER_UNAVAILABLE so the orchestrator
 * falls back gracefully and callers know not to expect real data.
 */

import { PricingError, PRICING_ERROR } from '@/lib/types/pricing';
import type { PricingProvider } from './provider';
import type { PricingResult } from '@/lib/types/domain';

export const ebayInsightsProvider: PricingProvider = {
  source: 'ebay-insights',

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async searchSoldListings(_query: string): Promise<PricingResult> {
    throw new PricingError(
      PRICING_ERROR.PROVIDER_UNAVAILABLE,
      'eBay Marketplace Insights API access not yet approved. Use ebay-browse provider in the meantime.'
    );
  },
};
