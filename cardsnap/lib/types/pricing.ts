/**
 * lib/types/pricing.ts
 *
 * Zod schemas for raw eBay Browse API response shapes.
 * These are the wire types — never exposed to callers outside lib/pricing/.
 * All external data from eBay is validated here before being mapped to the
 * canonical domain PricingResult in lib/types/domain.ts.
 */

import { z } from 'zod';

// ─── eBay price field ─────────────────────────────────────────────────────────

export const EbayPriceSchema = z.object({
  value: z.string(),
  currency: z.string(),
});

// ─── Individual item summary returned by Browse item_summary/search ───────────

export const EbayItemSummarySchema = z.object({
  itemId: z.string(),
  title: z.string(),
  price: EbayPriceSchema,
  condition: z.string().optional(),
  // itemEndDate is present on ended/sold items; listingEndDate on active
  itemEndDate: z.string().optional(),
  listingEndDate: z.string().optional(),
});

export type EbayItemSummary = z.infer<typeof EbayItemSummarySchema>;

// ─── Browse search response envelope ─────────────────────────────────────────

export const EbaySearchResponseSchema = z.object({
  itemSummaries: z.array(EbayItemSummarySchema).optional().default([]),
  total: z.number().optional(),
  warnings: z.array(z.unknown()).optional(),
});

export type EbaySearchResponse = z.infer<typeof EbaySearchResponseSchema>;

// ─── OAuth token response ─────────────────────────────────────────────────────

export const EbayTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
});

export type EbayTokenResponse = z.infer<typeof EbayTokenResponseSchema>;

// ─── Typed pricing errors ─────────────────────────────────────────────────────

export const PRICING_ERROR = {
  NO_RESULTS: 'NO_RESULTS',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  AUTH_FAILED: 'AUTH_FAILED',
  REQUEST_FAILED: 'REQUEST_FAILED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
} as const satisfies Record<string, string>;

export type PricingErrorCode = (typeof PRICING_ERROR)[keyof typeof PRICING_ERROR];

export class PricingError extends Error {
  readonly code: PricingErrorCode;
  constructor(code: PricingErrorCode, message: string) {
    super(message);
    this.name = 'PricingError';
    this.code = code;
  }
}
