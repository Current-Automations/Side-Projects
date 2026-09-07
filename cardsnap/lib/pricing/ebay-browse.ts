/**
 * lib/pricing/ebay-browse.ts
 *
 * PricingProvider backed by the eBay Browse API (item_summary/search).
 *
 * IMPORTANT: The Browse API returns ACTIVE listings (current asking prices),
 * NOT completed/sold comps. This is an intentional stopgap — the Marketplace
 * Insights API (true sold data) requires eBay approval and is stubbed in
 * ebay-insights.ts. Swap providers in lib/pricing/index.ts once approved.
 *
 * OAuth: client-credentials grant (Application token). The token is cached
 * in-module and refreshed 60 seconds before expiry.
 */

import { requireEbayCredentials } from '@/lib/types/env';
import {
  EbaySearchResponseSchema,
  EbayTokenResponseSchema,
  PricingError,
  PRICING_ERROR,
} from '@/lib/types/pricing';
import type { PricingProvider } from './provider';
import type { PricingResult } from '@/lib/types/domain';
import type { CardIdentification } from '@/lib/types/identification';

const EBAY_AUTH_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_BROWSE_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const SPORTS_CARD_CATEGORY = '212';
const TOKEN_REFRESH_BUFFER_MS = 60_000;

// ─── In-module token cache ────────────────────────────────────────────────────

let _cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
    return _cachedToken.value;
  }

  const { appId, certId } = requireEbayCredentials();
  const credentials = Buffer.from(`${appId}:${certId}`).toString('base64');

  const response = await fetch(EBAY_AUTH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  });

  if (!response.ok) {
    throw new PricingError(
      PRICING_ERROR.AUTH_FAILED,
      `eBay OAuth failed: ${response.status} ${response.statusText}`
    );
  }

  const raw: unknown = await response.json();
  const parsed = EbayTokenResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PricingError(PRICING_ERROR.AUTH_FAILED, 'eBay token response failed validation');
  }

  _cachedToken = {
    value: parsed.data.access_token,
    expiresAt: Date.now() + parsed.data.expires_in * 1000,
  };

  return _cachedToken.value;
}

// ─── Query builder ────────────────────────────────────────────────────────────

/**
 * Builds a Browse API search query for a card identification.
 * - Serial number intentionally excluded — too specific, returns zero results.
 * - Grade appended when is_graded=true so results skew toward graded comps.
 */
export function buildQuery(card: CardIdentification): string {
  const parts: string[] = [
    `"${card.player_name}"`,
    `"${card.year}"`,
    `"${card.product_line}"`,
  ];

  if (card.parallel_name && card.parallel_name !== 'Base') {
    parts.push(`"${card.parallel_name}"`);
  }

  if (card.is_graded && card.grade_company) {
    const grade = card.grade_value ? `${card.grade_company} ${card.grade_value}` : card.grade_company;
    parts.push(`"${grade}"`);
  }

  parts.push('card');

  return parts.join(' ');
}

// ─── Provider implementation ──────────────────────────────────────────────────

export const ebayBrowseProvider: PricingProvider = {
  source: 'ebay-browse',

  async searchSoldListings(query: string): Promise<PricingResult> {
    const token = await getAccessToken();

    const url = new URL(EBAY_BROWSE_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('category_ids', SPORTS_CARD_CATEGORY);
    url.searchParams.set('limit', '10');
    url.searchParams.set('sort', '-itemEndDate');

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    });

    if (!response.ok) {
      throw new PricingError(
        PRICING_ERROR.REQUEST_FAILED,
        `eBay Browse request failed: ${response.status} ${response.statusText}`
      );
    }

    const raw: unknown = await response.json();
    const parsed = EbaySearchResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PricingError(
        PRICING_ERROR.VALIDATION_FAILED,
        `eBay Browse response failed validation: ${parsed.error.message}`
      );
    }

    const items = parsed.data.itemSummaries;
    if (items.length === 0) {
      throw new PricingError(PRICING_ERROR.NO_RESULTS, `No listings found for query: ${query}`);
    }

    const prices = items.map((item) => parseFloat(item.price.value)).filter((p) => !isNaN(p));
    if (prices.length === 0) {
      throw new PricingError(PRICING_ERROR.NO_RESULTS, 'eBay items had no parseable prices');
    }

    const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;

    const sales = items.slice(0, 10).map((item) => ({
      price: parseFloat(item.price.value),
      date: item.itemEndDate ?? item.listingEndDate ?? new Date().toISOString(),
      title: item.title,
      condition: item.condition,
    }));

    return {
      avg_sold_price: Math.round(avg * 100) / 100,
      last_10_sales: sales,
      sample_size: items.length,
      fetched_at: new Date().toISOString(),
      attribution: 'Prices from eBay',
    };
  },
};
