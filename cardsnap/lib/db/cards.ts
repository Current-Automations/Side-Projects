/**
 * lib/db/cards.ts
 *
 * Card catalog queries.
 * All writes use the server client (service_role).
 * Fuzzy matching is scored locally after a broad DB query.
 */
import { getServerClient } from './server-client'
import { InsertCardSchema } from '../types/db'
import type { Card, InsertCard, DbResult } from '../types/db'

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '')
}

function scoreMatch(
  card: Card,
  params: { player_name: string; year: number; manufacturer: string; set_name: string; parallel?: string }
): number {
  let score = 0
  if (normalize(card.player_name) === normalize(params.player_name)) score += 3
  if (normalize(card.manufacturer) === normalize(params.manufacturer))  score += 2
  if (normalize(card.set_name) === normalize(params.set_name))          score += 2
  if (params.parallel && normalize(card.parallel) === normalize(params.parallel)) score += 1
  return score
}

/**
 * Fuzzy card lookup. Returns the best match (score ≥ 3) or null.
 * Also returns the match_confidence (0–1) for the caller to decide
 * whether to ask the user to confirm.
 */
export async function findCard(params: {
  player_name:  string
  year:         number
  manufacturer: string
  set_name:     string
  parallel?:    string
}): Promise<DbResult<{ card: Card; match_confidence: number } | null>> {
  try {
    const db = getServerClient()

    const { data, error } = await db
      .from('cards')
      .select('*')
      .ilike('player_name', `%${params.player_name}%`)
      .eq('year', params.year)
      .limit(10)

    if (error) return { success: false, error: error.message }
    if (!data || data.length === 0) return { success: true, data: null }

    const scored = (data as Card[]).map((card) => ({
      card,
      score: scoreMatch(card, params),
    }))

    const best = scored.sort((a, b) => b.score - a.score)[0]

    // Max possible score is 8 (player+year+manufacturer+set+parallel), require ≥ 3
    const match_confidence = best.score / 8

    if (best.score < 3) return { success: true, data: null }

    return { success: true, data: { card: best.card, match_confidence } }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function getCardById(id: string): Promise<DbResult<Card>> {
  try {
    const db = getServerClient()
    const { data, error } = await db
      .from('cards')
      .select('*')
      .eq('id', id)
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as Card }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function insertCard(input: InsertCard): Promise<DbResult<Card>> {
  try {
    const validated = InsertCardSchema.parse(input)
    const db = getServerClient()

    const { data, error } = await db
      .from('cards')
      .insert(validated)
      .select()
      .single()

    if (error) return { success: false, error: error.message }
    return { success: true, data: data as Card }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
