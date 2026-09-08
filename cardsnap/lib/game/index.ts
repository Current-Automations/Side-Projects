/**
 * lib/game — the shop game (Phase 3).
 *
 * Deep module: the API routes under app/api/game/* call these five operations
 * and nothing else. Supabase, the RPCs, pool selection and option shuffling all
 * stay behind this interface (mirrors lib/catalog, lib/pricing, lib/ai).
 */
import type { DbResult } from '../types/db';
import {
  getShop,
  touchPlayer,
  setDisplayName,
  drawSetRound,
  createRound,
  loadRoundForAnswer,
  recordAnswer,
  getLeaderboard,
  imageUrl,
} from './store';
import { pickPool, buildSetRound } from './rounds';
import type {
  ShopConfig,
  RoundRequest,
  RoundQuestion,
  AnswerRequest,
  AnswerResult,
  LeaderboardEntry,
} from './schemas';

export {
  ShopConfigSchema,
  RoundRequestSchema,
  AnswerRequestSchema,
  DisplayNameSchema,
  GameModeSchema,
} from './schemas';
export type {
  ShopConfig,
  RoundQuestion,
  AnswerResult,
  LeaderboardEntry,
  GameMode,
} from './schemas';

export function getShopConfig(slug: string): Promise<DbResult<ShopConfig>> {
  return getShop(slug);
}

export function leaderboard(shopSlug: string): Promise<DbResult<LeaderboardEntry[]>> {
  return getLeaderboard(shopSlug);
}

export async function claimDisplayName(
  deviceId: string,
  shopSlug: string,
  name: string
): Promise<DbResult<void>> {
  const touched = await touchPlayer(deviceId, shopSlug);
  if (!touched.success) return touched;
  return setDisplayName(deviceId, name);
}

export async function startRound(req: RoundRequest): Promise<DbResult<RoundQuestion>> {
  if (req.mode === 'variant') {
    return { success: false, error: 'variant mode is not available yet' };
  }

  const touched = await touchPlayer(req.deviceId, req.shopSlug);
  if (!touched.success) return touched;

  const pool = pickPool(['control']);

  const draw = await drawSetRound();
  if (!draw.success) return draw;
  if (!draw.data) return { success: false, error: 'no cards available for this game' };

  const built = buildSetRound(draw.data);

  const created = await createRound({
    deviceId: req.deviceId,
    cardId: built.cardId,
    pool,
    mode: built.mode,
    choices: built.choices,
    correct: built.correct,
  });
  if (!created.success) return created;

  return {
    success: true,
    data: {
      roundId: created.data,
      mode: built.mode,
      prompt: built.prompt,
      imageUrl: imageUrl(built.imagePath),
      choices: built.choices,
    },
  };
}

export async function answerRound(req: AnswerRequest): Promise<DbResult<AnswerResult>> {
  const round = await loadRoundForAnswer(req.roundId, req.deviceId);
  if (!round.success) return round;
  if (round.data.answered) return { success: false, error: 'round already answered' };

  const isCorrect = req.answer === round.data.correct;
  const scored = round.data.pool !== 'unknown';

  const recorded = await recordAnswer({
    roundId: req.roundId,
    deviceId: req.deviceId,
    answer: req.answer,
    isCorrect,
    timeMs: req.timeMs,
    scored,
  });
  if (!recorded.success) return recorded;

  return {
    success: true,
    data: {
      correct: isCorrect,
      correctAnswer: round.data.correct,
      scored,
      player: recorded.data,
    },
  };
}
