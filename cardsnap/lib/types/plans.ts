/**
 * lib/types/plans.ts
 *
 * Plan tier types, daily quota map, and tier utility helpers.
 * Business logic lives in services — this file is types and constants only.
 */

export type PlanTier = 'free' | 'basic' | 'pro' | 'streamer';

/**
 * Daily scan quota per tier.
 * null means unlimited.
 * Uses `satisfies` to enforce the shape without widening the literal types.
 */
export const DAILY_QUOTA: Record<PlanTier, number | null> = {
  free: 10,
  basic: 100,
  pro: null,
  streamer: null,
} satisfies Record<PlanTier, number | null>;

/** Returns true if the given tier has no daily scan cap. */
export function isUnlimited(tier: PlanTier): boolean {
  return DAILY_QUOTA[tier] === null;
}
