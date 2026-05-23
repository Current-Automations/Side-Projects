/**
 * lib/db/price-cache.ts
 *
 * eBay price cache — 4-hour TTL.
 * generateFingerprint() is deterministic: same card + grade → same hash.
 */
import { createHash } from 'crypto'
import { getServerClient } from './server-client'
import type { PriceCache, Sale, DbResult } from '../types/db'

const CACHE_TTL_MS = 4 * 60 * 60 * 1000 // 4 hours

export function generateFingerprint(params: {
  player_name:   string
  year:          number
  manufacturer:  string
  set_name:      string
  parallel:      string
  grade_company?: string | null
  grade_value?:   string | null
}): string {
  const raw = [
    params.player_name.toLowerCase().trim(),
    String(params.year),
    params.manufacturer.toLowerCase().trim(),
    params.set_name.toLowerCase().trim(),
    params.parallel.toLowerCase().trim(),
    params.grade_company ?? '',
    params.grade_value ?? '',
  ].join('|')

  return createHash('sha256').update(raw).digest('hex')
}

/** Returns a cached price only if it has not expired. */
export async function getCachedPrice(fingerprint: string): Promise<DbResult<PriceCache | null>> {
  try {
    const db = getServerClient()

    const { data, error } = await db
      .from('price_cache')
      .select('*')
      .eq('card_fingerprint', fingerprint)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as PriceCache | null }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/** Upserts a price cache entry with a fresh 4-hour TTL. */
export async function setCachedPrice(params: {
  fingerprint:   string
  avgSoldPrice:  number
  last10Sales:   Sale[]
  grade?:        string | null
  gradeCompany?: string | null
}): Promise<DbResult<PriceCache>> {
  try {
    const db = getServerClient()
    const now = new Date()

    const { data, error } = await db
      .from('price_cache')
      .upsert(
        {
          card_fingerprint: params.fingerprint,
          avg_sold_price:   params.avgSoldPrice,
          last_10_sales:    params.last10Sales,
          grade:            params.grade ?? null,
          grade_company:    params.gradeCompany ?? null,
          fetched_at:       now.toISOString(),
          expires_at:       new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
        },
        { onConflict: 'card_fingerprint' }
      )
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as PriceCache }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/** Gets the previous avg price for a fingerprint, ignoring TTL (for trend calculation). */
export async function getPreviousAvgPrice(fingerprint: string): Promise<DbResult<number | null>> {
  try {
    const db = getServerClient()

    const { data, error } = await db
      .from('price_cache')
      .select('avg_sold_price')
      .eq('card_fingerprint', fingerprint)
      .maybeSingle()

    if (error) return { success: false, error: error.message }
    return { success: true, data: (data?.avg_sold_price as number) ?? null }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
