/**
 * lib/types/domain.ts
 *
 * Core domain schemas for CardSnap.
 * All types are inferred from Zod schemas — no manual type duplication.
 * All external data (AI responses, API payloads) must pass through these schemas.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Scalar enums
// ---------------------------------------------------------------------------

/** Matches TCGdex `variants` flags (lib/catalog/transform.ts possibleFinishes). */
export const FinishSchema = z.enum([
  'normal',
  'holo',
  'reverse',
  'first_edition',
  'unlimited',
  'promo',
]);

export const GradeCompanySchema = z.enum(['PSA', 'BGS', 'SGC', 'CGC']);

// ---------------------------------------------------------------------------
// Card identification — the primary AI output shape
// ---------------------------------------------------------------------------

// Base object (no refinements) — `.partial()`/`.required()` can only operate on
// a plain object schema, so CorrectionSchema below derives from this, while the
// refined CardIdentificationSchema is the one used to validate full AI output.
export const CardIdentificationObject = z.object({
  card_name: z.string().min(1),
  /** TCGdex set id, e.g. "sv03" — the model rarely knows this outright; usually filled in later by match.ts. */
  set_id: z.string().optional(),
  /** Best-effort set name read off the card/packaging, e.g. "Obsidian Flames". */
  set_name: z.string().optional(),
  /** Printed collector number (TCGdex local_id), e.g. "125" or "125/197". */
  card_number: z.string().optional(),
  finish: FinishSchema,
  is_graded: z.boolean(),
  grade_company: GradeCompanySchema.optional(),
  grade_value: z
    .string()
    .regex(/^\d+(\.\d)?$/)
    .optional(),
  confidence: z.number().min(0).max(1),
  finish_confidence: z.number().min(0).max(1),
  needs_confirmation: z.boolean().default(false),
  error: z.string().optional(),
});

export const CardIdentificationSchema = CardIdentificationObject
  .refine(
    (data) => !data.is_graded || data.grade_company !== undefined,
    { message: 'grade_company required when is_graded is true' }
  )
  .refine(
    (data) => data.grade_company !== 'BGS' || data.grade_value !== undefined,
    { message: 'grade_value required for BGS cards' }
  );

export type CardIdentification = z.infer<typeof CardIdentificationSchema>;

export const CONFIDENCE_THRESHOLDS = {
  OVERALL_MIN: 0.5,
  FINISH_MIN: 0.6,
  HIGH_CONFIDENCE: 0.85,
} satisfies Record<string, number>;

// ---------------------------------------------------------------------------
// Pricing result — comp summary from whichever provider answered
// ---------------------------------------------------------------------------

export const PricingResultSchema = z.object({
  avg_sold_price: z.number().min(0),
  last_10_sales: z
    .array(
      z.object({
        price: z.number(),
        date: z.string(),
        title: z.string(),
        grade: z.string().optional(),
        condition: z.string().optional(),
      })
    )
    .max(10),
  sample_size: z.number().int().min(0),
  fetched_at: z.string(),
  /** Free-form per-provider credit line, e.g. "Prices from tcgapi.net (eBay sold comps)". */
  attribution: z.string().min(1),
});

export type PricingResult = z.infer<typeof PricingResultSchema>;

// ---------------------------------------------------------------------------
// Scan result — full response returned by POST /api/scan
// ---------------------------------------------------------------------------

export const PriceTrendSchema = z.enum(['up', 'down', 'stable', 'new']);
export type PriceTrend = z.infer<typeof PriceTrendSchema>;

export const ScanResultSchema = z.object({
  scan_id: z.string().uuid(),
  card: CardIdentificationSchema,
  /** null when pricing is unavailable (provider down, no results, etc.) */
  pricing: PricingResultSchema.nullable(),
  trend: PriceTrendSchema.nullable(),
  remaining_scans: z.number().int().min(0).nullable(),
  cache_hit: z.boolean(),
  /** The catalog card the identification resolved to; null on a cache hit or no match. */
  matched_card: z
    .object({
      id: z.string(),
      name: z.string(),
      set_id: z.string(),
      set_name: z.string().nullable(),
      local_id: z.string(),
      image_url: z.string().nullable(),
    })
    .nullable()
    .optional(),
  /** An anniversary reprint of the matched card, told apart only by its logo stamp. */
  stamped_reprint: z.string().nullable().optional(),
  /** True when the catalog match was too weak to trust. */
  needs_confirmation: z.boolean().optional(),
  printings: z.number().int().optional(),
});

export type ScanResult = z.infer<typeof ScanResultSchema>;

// ---------------------------------------------------------------------------
// Correction — user-submitted correction to an AI identification
// ---------------------------------------------------------------------------

export const CorrectionSchema = z.object({
  scan_id: z.string().uuid(),
  corrected_card: CardIdentificationObject.partial().required({
    card_name: true,
    finish: true,
  }),
});

export type Correction = z.infer<typeof CorrectionSchema>;
