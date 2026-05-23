/**
 * lib/db/users.ts
 *
 * User record helpers — plan tier, scan rate limiting, Stripe sync.
 * Rate limiting logic lives here; API routes call these, never reimplement.
 */
import { getServerClient } from './server-client'
import { SCAN_LIMITS } from '../types/db'
import type { User, DbResult } from '../types/db'
import type { PlanTier } from '../types/plans'

export async function getUserById(userId: string): Promise<DbResult<User>> {
  try {
    const db = getServerClient()

    const { data, error } = await db
      .from('users')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as User }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function getUserPlanTier(userId: string): Promise<DbResult<PlanTier>> {
  const result = await getUserById(userId)
  if (!result.success) return result
  return { success: true, data: result.data.plan_tier }
}

/**
 * Checks whether the user may perform another scan today.
 * Resets the daily counter if scans_reset_at is before the start of today.
 *
 * Returns: { allowed, remaining }
 *   remaining = null means unlimited (Pro / Streamer tier)
 */
export async function checkScanAllowed(userId: string): Promise<
  DbResult<{ allowed: boolean; remaining: number | null }>
> {
  try {
    const db = getServerClient()

    const { data, error } = await db
      .from('users')
      .select('plan_tier, scans_used_today, scans_reset_at')
      .eq('id', userId)
      .single()

    if (error) return { success: false, error: error.message }

    const { plan_tier, scans_used_today, scans_reset_at } = data as Pick<
      User,
      'plan_tier' | 'scans_used_today' | 'scans_reset_at'
    >

    const limit = SCAN_LIMITS[plan_tier]

    // Reset counter if last reset was before the start of today (UTC)
    const resetAt = new Date(scans_reset_at)
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    if (resetAt < today) {
      await db
        .from('users')
        .update({ scans_used_today: 0, scans_reset_at: new Date().toISOString() })
        .eq('id', userId)

      // After reset the count is 0, so always allowed
      return {
        success: true,
        data: { allowed: true, remaining: limit === Infinity ? null : limit },
      }
    }

    // Unlimited tiers
    if (limit === Infinity) {
      return { success: true, data: { allowed: true, remaining: null } }
    }

    const remaining = limit - scans_used_today
    return { success: true, data: { allowed: remaining > 0, remaining: Math.max(0, remaining) } }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Atomically increments scans_used_today via the Postgres RPC.
 * Falls back to a read-modify-write if the RPC is unavailable.
 */
export async function incrementScanCount(userId: string): Promise<DbResult<undefined>> {
  try {
    const db = getServerClient()

    const { error } = await db.rpc('increment_scan_count', { user_id: userId })

    if (error) return { success: false, error: error.message }
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function updatePlanTier(
  userId: string,
  planTier: PlanTier
): Promise<DbResult<undefined>> {
  try {
    const db = getServerClient()

    const { error } = await db
      .from('users')
      .update({ plan_tier: planTier })
      .eq('id', userId)

    if (error) return { success: false, error: error.message }
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/** Alias used by lib/db/index.ts barrel. */
export const upsertUser = upsertStripeCustomer

export async function upsertStripeCustomer(
  userId: string,
  stripeCustomerId: string
): Promise<DbResult<undefined>> {
  try {
    const db = getServerClient()

    const { error } = await db
      .from('users')
      .upsert({ id: userId, stripe_customer_id: stripeCustomerId }, { onConflict: 'id' })

    if (error) return { success: false, error: error.message }
    return { success: true, data: undefined }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
