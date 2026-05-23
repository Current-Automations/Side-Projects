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

export const SportSchema = z.enum(['NFL', 'NBA', 'MLB', 'NHL']);

export const ManufacturerSchema = z.enum([
  'Panini',
  'Topps',
  'Upper Deck',
  'Leaf',
  'Donruss',
]);

export const GradeCompanySchema = z.enum(['PSA', 'BGS', 'SGC', 'CGC']);

// ---------------------------------------------------------------------------
// Card identification — the primary AI output shape
// ---------------------------------------------------------------------------

export const CardIdentificationSchema = z
  .object({
    sport: SportSchema,
    player_name: z.string().min(1),
    year: z.number().int().min(1980).max(2030),
    manufacturer: ManufacturerSchema,
    product_line: z.string().min(1),
    set_variant: z.string().optional(),
    card_number: z.string().optional(),
    parallel_name: z.string().default('Base'),
    serial_number: z
      .string()
      .regex(/^(\d+\/\d+|\/\d+)$/)
      .optional(),
    is_graded: z.boolean(),
    grade_company: GradeCompanySchema.optional(),
    grade_value: z
      .string()
      .regex(/^\d+(\.\d)?$/)
      .optional(),
    bgs_black_label: z.boolean().optional(),
    confidence: z.number().min(0).max(1),
    parallel_confidence: z.number().min(0).max(1),
    needs_confirmation: z.boolean().default(false),
    error: z.string().optional(),
  })
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
  PARALLEL_MIN: 0.6,
  HIGH_CONFIDENCE: 0.85,
} satisfies Record<string, number>;

// ---------------------------------------------------------------------------
// Pricing result — eBay sold listings summary
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
  attribution: z.literal('Prices from eBay'),
});

export type PricingResult = z.infer<typeof PricingResultSchema>;

// ---------------------------------------------------------------------------
// Scan result — full response returned by POST /api/scan
// ---------------------------------------------------------------------------

export const ScanResultSchema = z.object({
  scan_id: z.string().uuid(),
  card: CardIdentificationSchema,
  pricing: PricingResultSchema,
  remaining_scans: z.number().int().min(0).nullable(),
  cache_hit: z.boolean(),
});

export type ScanResult = z.infer<typeof ScanResultSchema>;

// ---------------------------------------------------------------------------
// Correction — user-submitted correction to an AI identification
// ---------------------------------------------------------------------------

export const CorrectionSchema = z.object({
  scan_id: z.string().uuid(),
  corrected_card: CardIdentificationSchema.partial().required({
    player_name: true,
    year: true,
    manufacturer: true,
    product_line: true,
  }),
});

export type Correction = z.infer<typeof CorrectionSchema>;
