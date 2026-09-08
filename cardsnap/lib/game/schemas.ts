/**
 * lib/game/schemas.ts
 *
 * Zod schemas and inferred types for the shop game (Phase 3).
 * Request bodies are validated at the API route; the shapes the route returns
 * to the browser are defined here so the deep module owns its contract.
 */
import { z } from 'zod';

/** localStorage-minted client id. Not required to be a UUID, treated as opaque. */
export const DeviceIdSchema = z.string().min(8).max(64);

/** Mode A ships in v1. 'variant' is reserved for when break frames exist. */
export const GameModeSchema = z.enum(['set', 'variant']);
export type GameMode = z.infer<typeof GameModeSchema>;

export const ShopConfigSchema = z.object({
  slug: z.string(),
  display_name: z.string(),
  logo_url: z.string().nullable(),
  theme_color: z.string().nullable(),
});
export type ShopConfig = z.infer<typeof ShopConfigSchema>;

// ── POST /api/game/round ─────────────────────────────────────────────────────

export const RoundRequestSchema = z.object({
  deviceId: DeviceIdSchema,
  shopSlug: z.string().min(1),
  mode: GameModeSchema.default('set'),
});
export type RoundRequest = z.infer<typeof RoundRequestSchema>;

/** What the browser gets. Never carries the correct answer. */
export interface RoundQuestion {
  roundId: string;
  mode: GameMode;
  prompt: string;
  imageUrl: string;
  choices: string[];
}

// ── POST /api/game/answer ────────────────────────────────────────────────────

export const AnswerRequestSchema = z.object({
  deviceId: DeviceIdSchema,
  roundId: z.string().uuid(),
  answer: z.string().min(1),
  timeMs: z.number().int().nonnegative().max(600_000).optional(),
});
export type AnswerRequest = z.infer<typeof AnswerRequestSchema>;

export interface AnswerResult {
  correct: boolean;
  correctAnswer: string;
  scored: boolean;
  player: {
    correct: number;
    answered: number;
    trustScore: number;
  };
}

// ── GET /api/game/leaderboard/[slug] ─────────────────────────────────────────

export interface LeaderboardEntry {
  displayName: string;
  correct: number;
  answered: number;
}

// ── display-name claim (shared with the round/answer flow) ───────────────────

export const DisplayNameSchema = z.string().trim().min(1).max(24);
