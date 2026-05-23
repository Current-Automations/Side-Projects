/**
 * lib/types/db.ts
 *
 * DB-layer Zod schemas and inferred types.
 * These represent raw Supabase row shapes — separate from domain types in domain.ts.
 *
 * Domain types (CardIdentification, PricingResult, ScanResult) live in domain.ts.
 * These are the persistence-layer counterparts.
 */
import { z } from 'zod'

// ─────────────────────────────────────────────
// SHARED RESULT TYPE
// ─────────────────────────────────────────────

/** Discriminated union returned by all DB helpers. Never throws — always returns a result. */
export type DbResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

// ─────────────────────────────────────────────
// CARDS (DB row)
// ─────────────────────────────────────────────

export const CardSchema = z.object({
  id:           z.string().uuid(),
  player_name:  z.string().min(1),
  year:         z.number().int().min(1900).max(2200),
  manufacturer: z.string().min(1),
  set_name:     z.string().min(1),
  parallel:     z.string().default('Base'),
  card_number:  z.string().nullable(),
  sport:        z.enum(['NFL', 'NBA', 'MLB', 'NHL']),
  created_at:   z.string(),
})
export type Card = z.infer<typeof CardSchema>

export const InsertCardSchema = CardSchema.omit({ id: true, created_at: true })
export type InsertCard = z.infer<typeof InsertCardSchema>

// ─────────────────────────────────────────────
// PRICE CACHE (DB row)
// ─────────────────────────────────────────────

export const SaleSchema = z.object({
  price:     z.number(),
  currency:  z.string(),
  date:      z.string(),
  title:     z.string(),
  condition: z.string().optional(),
  grade:     z.string().optional(),
})
export type Sale = z.infer<typeof SaleSchema>

export const PriceCacheSchema = z.object({
  id:               z.string().uuid(),
  card_fingerprint: z.string(),
  avg_sold_price:   z.number().nullable(),
  last_10_sales:    z.array(SaleSchema).nullable(),
  grade:            z.string().nullable(),
  grade_company:    z.enum(['PSA', 'BGS', 'SGC', 'CGC']).nullable(),
  fetched_at:       z.string(),
  expires_at:       z.string(),
})
export type PriceCache = z.infer<typeof PriceCacheSchema>

// ─────────────────────────────────────────────
// USERS (DB row)
// ─────────────────────────────────────────────

export const UserSchema = z.object({
  id:                 z.string().uuid(),
  stripe_customer_id: z.string().nullable(),
  plan_tier:          z.enum(['free', 'basic', 'pro', 'streamer']),
  timezone:           z.string(),
  scans_used_today:   z.number().int(),
  scans_reset_at:     z.string(),
  created_at:         z.string(),
})
export type User = z.infer<typeof UserSchema>

/** Daily scan limits. Infinity = unlimited (Pro / Streamer). */
export const SCAN_LIMITS = {
  free:     10,
  basic:    100,
  pro:      Infinity,
  streamer: Infinity,
} satisfies Record<z.infer<typeof UserSchema>['plan_tier'], number>

// ─────────────────────────────────────────────
// SCAN LOGS (DB row)
// ─────────────────────────────────────────────

export const ScanLogSchema = z.object({
  id:                z.string().uuid(),
  user_id:           z.string().uuid(),
  card_id:           z.string().uuid().nullable(),
  image_hash:        z.string(),
  ai_response:       z.unknown(),
  model_used:        z.string().nullable(),
  final_card_id:     z.string().uuid().nullable(),
  was_corrected:     z.boolean(),
  correction_source: z.string().nullable(),
  price_at_scan:     z.number().nullable(),
  cache_hit:         z.boolean().nullable(),
  created_at:        z.string(),
})
export type ScanLog = z.infer<typeof ScanLogSchema>

export const InsertScanLogSchema = z.object({
  user_id:       z.string().uuid(),
  card_id:       z.string().uuid().optional(),
  image_hash:    z.string().min(1),
  ai_response:   z.unknown().optional(),
  model_used:    z.string().optional(),
  final_card_id: z.string().uuid().optional(),
  price_at_scan: z.number().optional(),
  cache_hit:     z.boolean().optional(),
})
export type InsertScanLog = z.infer<typeof InsertScanLogSchema>

// ─────────────────────────────────────────────
// TRAINING EXAMPLES (DB insert input)
// ─────────────────────────────────────────────

/** Input type for inserting a training example row. */
export const InsertTrainingExampleSchema = z.object({
  image_hash:      z.string().min(1),
  correct_labels:  z.record(z.string(), z.unknown()),
  source:          z.enum(['user_correction', 'confirmed', 'bootstrap']),
  training_set_id: z.string().uuid().optional(),
  generation:      z.number().int().default(0),
})
export type InsertTrainingExample = z.infer<typeof InsertTrainingExampleSchema>

/** Alias used by the index barrel. */
export type InsertTrainingExampleInput = InsertTrainingExample

/** Result type returned by pruneOldGenerations(). */
export type PruneResult = { deletedExamples: number; deletedRuns: number }
