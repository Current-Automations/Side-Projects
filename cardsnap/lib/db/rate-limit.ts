/**
 * lib/db/rate-limit.ts
 *
 * Query helpers for scan-rate limiting.
 *
 * Plan tier limits:
 *   free:      10 scans/day
 *   basic:     100 scans/day
 *   pro:       unlimited
 *   streamer:  unlimited
 */

import { createServerClient } from './client';
import type { PlanTierValue } from './schema';

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const TIER_DAILY_LIMITS: Record<PlanTierValue, number | null> = {
  free: 10,
  basic: 100,
  pro: null,       // unlimited
  streamer: null,  // unlimited
};

const UNLIMITED_TIERS: ReadonlySet<PlanTierValue> = new Set(['pro', 'streamer']);

// ---------------------------------------------------------------------------
// getRateLimit
// ---------------------------------------------------------------------------

/**
 * Returns the number of scans remaining today for the given user.
 * Returns `null` for pro and streamer tiers (unlimited).
 * Returns 0 if the user has exhausted their daily limit.
 * Returns the tier default (10) if no user row exists (treat as free tier).
 */
export async function getRateLimit(
  userId: string
): Promise<{ remaining: number | null }> {
  const client = createServerClient();

  const { data, error } = await client
    .from('users')
    .select('plan_tier, scans_used_today')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`getRateLimit: ${error.message}`);
  }

  // Default to free tier if user row doesn't exist yet
  const tier: PlanTierValue = (data?.plan_tier as PlanTierValue | undefined) ?? 'free';
  const usedToday: number = data?.scans_used_today ?? 0;

  if (UNLIMITED_TIERS.has(tier)) {
    return { remaining: null };
  }

  const limit = TIER_DAILY_LIMITS[tier] ?? 10;
  const remaining = Math.max(0, limit - usedToday);

  return { remaining };
}

// ---------------------------------------------------------------------------
// decrementRateLimit
// ---------------------------------------------------------------------------

/**
 * Atomically increments `scans_used_today` for the given user via a Postgres
 * RPC function named `increment_scan_count`.
 *
 * No-op for unlimited-tier users (pro, streamer) — checks plan_tier first to
 * avoid unnecessary DB writes.
 *
 * The RPC function is responsible for atomicity; this helper does not use
 * optimistic updates.
 */
export async function decrementRateLimit(userId: string): Promise<void> {
  const client = createServerClient();

  // Check tier before calling RPC to avoid unnecessary work for unlimited tiers
  const { data, error: tierError } = await client
    .from('users')
    .select('plan_tier')
    .eq('id', userId)
    .maybeSingle();

  if (tierError) {
    throw new Error(`decrementRateLimit (tier check): ${tierError.message}`);
  }

  const tier: PlanTierValue = (data?.plan_tier as PlanTierValue | undefined) ?? 'free';

  if (UNLIMITED_TIERS.has(tier)) {
    // Unlimited plan — no-op
    return;
  }

  const { error: rpcError } = await client.rpc('increment_scan_count', {
    user_id: userId,
  });

  if (rpcError) {
    throw new Error(`decrementRateLimit (rpc): ${rpcError.message}`);
  }
}

// ---------------------------------------------------------------------------
// resetStaleLimits
// ---------------------------------------------------------------------------

/**
 * Resets `scans_used_today` to 0 for any user whose `scans_reset_at` is more
 * than 24 hours in the past.
 *
 * This is called by a scheduled cron job — NOT by the scan endpoint.
 * Updating `scans_reset_at` to now() is done inside the UPDATE so the next
 * reset window starts from the moment the reset fires.
 */
export async function resetStaleLimits(): Promise<void> {
  const client = createServerClient();

  // Use a raw Postgres expression for the 24-hour window comparison
  const { error } = await client
    .from('users')
    .update({ scans_used_today: 0, scans_reset_at: new Date().toISOString() })
    .lt('scans_reset_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  if (error) {
    throw new Error(`resetStaleLimits: ${error.message}`);
  }
}
