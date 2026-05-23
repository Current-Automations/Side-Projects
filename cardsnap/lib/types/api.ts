/**
 * lib/types/api.ts
 *
 * Response envelope, error codes, and per-route request/response types
 * for all CardSnap API routes.
 *
 * Pattern: { success: true; data: T } | { success: false; error: string; code: string }
 */

import { z } from 'zod';
import type { ScanResult, PricingResult } from './domain';
import { CorrectionSchema } from './domain';

// ---------------------------------------------------------------------------
// Generic response envelope
// ---------------------------------------------------------------------------

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code: string };

// ---------------------------------------------------------------------------
// Error codes — exhaustive const enum equivalent
// ---------------------------------------------------------------------------

export const ApiErrorCode = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INVALID_IMAGE: 'INVALID_IMAGE',
  IDENTIFICATION_FAILED: 'IDENTIFICATION_FAILED',
  DB_ERROR: 'DB_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const satisfies Record<string, string>;

export type ApiErrorCodeValue = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

// ---------------------------------------------------------------------------
// POST /api/scan
// ---------------------------------------------------------------------------

/** Raw base-64 image string. Min 100 chars guards against trivially empty/invalid input. */
export const ScanRequestSchema = z.object({
  image: z.string().min(100, 'image must be a non-empty base-64 encoded string'),
});

export type ScanRequest = z.infer<typeof ScanRequestSchema>;
export type ScanResponse = ApiResponse<ScanResult>;

// ---------------------------------------------------------------------------
// GET /api/card/[id]/prices (price refresh)
// ---------------------------------------------------------------------------

export type PriceRefreshResponse = ApiResponse<{ pricing: PricingResult }>;

// ---------------------------------------------------------------------------
// POST /api/scan/correct
// ---------------------------------------------------------------------------

export type CorrectionRequest = z.infer<typeof CorrectionSchema>;
export type CorrectionResponse = ApiResponse<{ pricing: PricingResult }>;
