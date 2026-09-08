/**
 * lib/game/store.ts
 *
 * Supabase-backed operations for the shop game. All writes use the service_role
 * client, because a browser that could set its own is_correct or
 * control_correct_count would be trivially cheatable (see 004_shop_game.sql).
 * Callers import from lib/game, never from here.
 */
import { getServerClient } from '../db/server-client';
import type { DbResult } from '../types/db';
import type { ShopConfig, LeaderboardEntry } from './schemas';

const BUCKET = 'catalog-images';

function fail(err: unknown): { success: false; error: string } {
  return { success: false, error: err instanceof Error ? err.message : String(err) };
}

/** Public Storage URL for an approved catalog image. */
export function imageUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return `${base}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

export async function getShop(slug: string): Promise<DbResult<ShopConfig>> {
  try {
    const db = getServerClient();
    const { data, error } = await db
      .from('shops')
      .select('slug, display_name, logo_url, theme_color')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();
    if (error || !data) return { success: false, error: 'shop not found' };
    return { success: true, data };
  } catch (err) {
    return fail(err);
  }
}

/** Upsert the player row and bump last_seen_at. */
export async function touchPlayer(deviceId: string, shopSlug: string): Promise<DbResult<void>> {
  try {
    const db = getServerClient();
    const { error } = await db
      .from('game_players')
      .upsert(
        { device_id: deviceId, shop_slug: shopSlug, last_seen_at: new Date().toISOString() },
        { onConflict: 'device_id' }
      );
    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch (err) {
    return fail(err);
  }
}

export async function setDisplayName(deviceId: string, name: string): Promise<DbResult<void>> {
  try {
    const db = getServerClient();
    const { error } = await db
      .from('game_players')
      .update({ display_name: name, last_seen_at: new Date().toISOString() })
      .eq('device_id', deviceId);
    if (error) return { success: false, error: error.message };
    return { success: true, data: undefined };
  } catch (err) {
    return fail(err);
  }
}

export interface RawSetDraw {
  card_id: string;
  card_name: string;
  set_id: string;
  set_name: string;
  image_path: string;
  distractor_sets: string[];
}

export async function drawSetRound(
  dexLo = 1,
  dexHi = 151
): Promise<DbResult<RawSetDraw | null>> {
  try {
    const db = getServerClient();
    const { data, error } = await db.rpc('game_draw_set_round', {
      p_dex_lo: dexLo,
      p_dex_hi: dexHi,
    });
    if (error) return { success: false, error: error.message };
    return { success: true, data: (data as RawSetDraw | null) ?? null };
  } catch (err) {
    return fail(err);
  }
}

export interface CreateRoundInput {
  deviceId: string;
  cardId: string | null;
  pool: 'control' | 'hard' | 'unknown';
  mode: 'set' | 'variant';
  choices: string[];
  correct: string;
}

export async function createRound(input: CreateRoundInput): Promise<DbResult<string>> {
  try {
    const db = getServerClient();
    const { data, error } = await db
      .from('game_rounds')
      .insert({
        device_id: input.deviceId,
        card_id: input.cardId,
        pool: input.pool,
        mode: input.mode,
        options: { choices: input.choices, correct: input.correct },
      })
      .select('id')
      .single();
    if (error || !data) return { success: false, error: error?.message ?? 'insert failed' };
    return { success: true, data: data.id as string };
  } catch (err) {
    return fail(err);
  }
}

export interface RoundForAnswer {
  id: string;
  device_id: string;
  pool: 'control' | 'hard' | 'unknown';
  answered: boolean;
  correct: string;
}

export async function loadRoundForAnswer(
  roundId: string,
  deviceId: string
): Promise<DbResult<RoundForAnswer>> {
  try {
    const db = getServerClient();
    const { data, error } = await db
      .from('game_rounds')
      .select('id, device_id, pool, options, answer_given')
      .eq('id', roundId)
      .single();
    if (error || !data) return { success: false, error: 'round not found' };
    if (data.device_id !== deviceId) return { success: false, error: 'round does not belong to this device' };
    const options = data.options as { choices: string[]; correct: string };
    return {
      success: true,
      data: {
        id: data.id as string,
        device_id: data.device_id as string,
        pool: data.pool as 'control' | 'hard' | 'unknown',
        answered: data.answer_given != null,
        correct: options.correct,
      },
    };
  } catch (err) {
    return fail(err);
  }
}

export interface PlayerStats {
  correct: number;
  answered: number;
  trustScore: number;
}

/**
 * Persist the answer on the round, and for scored pools (control, hard) bump the
 * player's counters atomically via the RPC. Unknown-pool rounds never touch the
 * score. Returns the player's fresh totals.
 */
export async function recordAnswer(args: {
  roundId: string;
  deviceId: string;
  answer: string;
  isCorrect: boolean;
  timeMs?: number;
  scored: boolean;
}): Promise<DbResult<PlayerStats>> {
  try {
    const db = getServerClient();

    const { error: roundErr } = await db
      .from('game_rounds')
      .update({
        answer_given: args.answer,
        is_correct: args.scored ? args.isCorrect : null,
        time_ms: args.timeMs ?? null,
      })
      .eq('id', args.roundId);
    if (roundErr) return { success: false, error: roundErr.message };

    if (args.scored) {
      const { error: rpcErr } = await db.rpc('record_control_answer', {
        p_device_id: args.deviceId,
        p_correct: args.isCorrect,
      });
      if (rpcErr) return { success: false, error: rpcErr.message };
    }

    const { data, error } = await db
      .from('game_players')
      .select('control_correct_count, control_answers_count, trust_score')
      .eq('device_id', args.deviceId)
      .single();
    if (error || !data) return { success: false, error: 'player not found' };

    return {
      success: true,
      data: {
        correct: (data.control_correct_count as number) ?? 0,
        answered: (data.control_answers_count as number) ?? 0,
        trustScore: Number(data.trust_score ?? 0),
      },
    };
  } catch (err) {
    return fail(err);
  }
}

export async function getLeaderboard(
  shopSlug: string,
  limit = 20
): Promise<DbResult<LeaderboardEntry[]>> {
  try {
    const db = getServerClient();
    const { data, error } = await db
      .from('game_players')
      .select('display_name, control_correct_count, control_answers_count')
      .eq('shop_slug', shopSlug)
      .not('display_name', 'is', null)
      .order('control_correct_count', { ascending: false })
      .limit(limit);
    if (error) return { success: false, error: error.message };
    const entries: LeaderboardEntry[] = (data ?? []).map((r) => ({
      displayName: r.display_name as string,
      correct: (r.control_correct_count as number) ?? 0,
      answered: (r.control_answers_count as number) ?? 0,
    }));
    return { success: true, data: entries };
  } catch (err) {
    return fail(err);
  }
}
