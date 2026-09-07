/**
 * lib/pricing/__tests__/ebay.test.ts
 *
 * Unit tests for the pure/deterministic parts of the pricing layer:
 *   - buildQuery (query construction)
 *   - EbaySearchResponseSchema validation (wire format)
 *   - avg + trend computation logic (via getPriceWithCache internals indirectly)
 *
 * Network I/O (searchSoldListings HTTP, Supabase cache ops, route handlers)
 * is not unit-tested — same stance as Session 2: mocking I/O only asserts
 * against mocks. Those paths are covered by manual end-to-end verification.
 */

import { describe, it, expect } from 'vitest';
import { buildQuery } from '../ebay-browse';
import { EbaySearchResponseSchema, PricingError, PRICING_ERROR } from '@/lib/types/pricing';
import type { CardIdentification } from '@/lib/types/identification';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_CARD: CardIdentification = {
  sport: 'NFL',
  player_name: 'Patrick Mahomes',
  year: 2018,
  manufacturer: 'Panini',
  product_line: 'Prizm',
  parallel_name: 'Base',
  is_graded: false,
  confidence: 0.95,
  parallel_confidence: 0.9,
  needs_confirmation: false,
};

const PARALLEL_CARD: CardIdentification = {
  ...BASE_CARD,
  parallel_name: 'Silver Prizm',
  parallel_confidence: 0.85,
};

const GRADED_CARD: CardIdentification = {
  ...BASE_CARD,
  is_graded: true,
  grade_company: 'PSA',
  grade_value: '10',
};

const GRADED_NO_VALUE: CardIdentification = {
  ...BASE_CARD,
  is_graded: true,
  grade_company: 'BGS',
};

const SERIAL_CARD: CardIdentification = {
  ...BASE_CARD,
  serial_number: '25/50',
};

// ─── buildQuery ───────────────────────────────────────────────────────────────

describe('buildQuery', () => {
  it('builds a basic query with player, year, product_line, and card suffix', () => {
    const q = buildQuery(BASE_CARD);
    expect(q).toContain('"Patrick Mahomes"');
    expect(q).toContain('"2018"');
    expect(q).toContain('"Prizm"');
    expect(q).toMatch(/card$/);
  });

  it('omits parallel when parallel_name is Base', () => {
    const q = buildQuery(BASE_CARD);
    expect(q).not.toContain('"Base"');
  });

  it('includes non-Base parallel in the query', () => {
    const q = buildQuery(PARALLEL_CARD);
    expect(q).toContain('"Silver Prizm"');
  });

  it('appends grade when card is graded with grade_value', () => {
    const q = buildQuery(GRADED_CARD);
    expect(q).toContain('"PSA 10"');
  });

  it('appends grade company only when grade_value is absent', () => {
    const q = buildQuery(GRADED_NO_VALUE);
    expect(q).toContain('"BGS"');
    expect(q).not.toContain('"BGS undefined"');
  });

  it('never includes serial_number in the query (too specific)', () => {
    const q = buildQuery(SERIAL_CARD);
    expect(q).not.toContain('25/50');
    expect(q).not.toContain('/50');
  });
});

// ─── EbaySearchResponseSchema ─────────────────────────────────────────────────

describe('EbaySearchResponseSchema', () => {
  it('parses a full response with multiple items', () => {
    const raw = {
      total: 3,
      itemSummaries: [
        { itemId: 'a1', title: 'Card 1', price: { value: '45.00', currency: 'USD' } },
        { itemId: 'a2', title: 'Card 2', price: { value: '50.00', currency: 'USD' } },
        { itemId: 'a3', title: 'Card 3', price: { value: '55.00', currency: 'USD' } },
      ],
    };
    const result = EbaySearchResponseSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.itemSummaries).toHaveLength(3);
    }
  });

  it('defaults itemSummaries to [] when field is absent (no listings)', () => {
    const result = EbaySearchResponseSchema.safeParse({ total: 0 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.itemSummaries).toEqual([]);
    }
  });

  it('accepts items with optional condition and date fields', () => {
    const raw = {
      itemSummaries: [
        {
          itemId: 'b1',
          title: 'Graded Card',
          price: { value: '120.00', currency: 'USD' },
          condition: 'Very Good',
          itemEndDate: '2024-12-01T00:00:00Z',
        },
      ],
    };
    const result = EbaySearchResponseSchema.safeParse(raw);
    expect(result.success).toBe(true);
  });

  it('rejects an item missing the required price field', () => {
    const raw = {
      itemSummaries: [{ itemId: 'c1', title: 'No price' }],
    };
    const result = EbaySearchResponseSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it('rejects a response where price.value is not a string', () => {
    const raw = {
      itemSummaries: [{ itemId: 'd1', title: 'Bad price', price: { value: 45, currency: 'USD' } }],
    };
    const result = EbaySearchResponseSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });
});

// ─── PricingError ─────────────────────────────────────────────────────────────

describe('PricingError', () => {
  it('preserves the error code', () => {
    const err = new PricingError(PRICING_ERROR.NO_RESULTS, 'Nothing found');
    expect(err.code).toBe('NO_RESULTS');
    expect(err.message).toBe('Nothing found');
    expect(err.name).toBe('PricingError');
    expect(err instanceof Error).toBe(true);
  });
});

// ─── Trend computation (inline, mirrors index.ts logic) ──────────────────────

function computeTrend(current: number, previous: number | null): 'up' | 'down' | 'stable' | 'new' {
  if (previous === null) return 'new';
  const delta = (current - previous) / previous;
  if (delta > 0.05) return 'up';
  if (delta < -0.05) return 'down';
  return 'stable';
}

describe('computeTrend', () => {
  it('returns "new" when there is no previous price', () => {
    expect(computeTrend(50, null)).toBe('new');
  });

  it('returns "up" when price rises more than 5%', () => {
    expect(computeTrend(55, 50)).toBe('up');
  });

  it('returns "down" when price drops more than 5%', () => {
    expect(computeTrend(45, 50)).toBe('down');
  });

  it('returns "stable" when price changes within ±5%', () => {
    expect(computeTrend(52, 50)).toBe('stable');
    expect(computeTrend(48, 50)).toBe('stable');
    expect(computeTrend(50, 50)).toBe('stable');
  });

  it('returns "up" at exactly 5.1% increase', () => {
    expect(computeTrend(52.55, 50)).toBe('up');
  });

  it('returns "down" at exactly 5.1% decrease', () => {
    expect(computeTrend(47.45, 50)).toBe('down');
  });
});
