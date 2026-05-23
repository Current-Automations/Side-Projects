/**
 * lib/db/index.ts
 *
 * Public API for the DB layer. Import from '@/lib/db' — never from individual files.
 *
 * Pattern:
 *   import { createScanLog, checkScanAllowed, getActiveTrainingRun } from '@/lib/db'
 */

// ─── Cards ────────────────────────────────────────────────────────────────────
export { findCard, getCardById, insertCard } from './cards'

// ─── Price cache ──────────────────────────────────────────────────────────────
export { generateFingerprint, getCachedPrice, setCachedPrice, getPreviousAvgPrice } from './price-cache'

// ─── Scan logs ────────────────────────────────────────────────────────────────
export { createScanLog, markScanCorrected, getRecentScans, getScanHistory } from './scan-logs'

// ─── Scans (legacy helpers — used by Session 2 scan endpoint) ─────────────────
export { writeScanResult, getScanById } from './scans'

// ─── Users + rate limiting ────────────────────────────────────────────────────
export {
  getUserById,
  getUserPlanTier,
  checkScanAllowed,
  incrementScanCount,
  updatePlanTier,
  upsertStripeCustomer,
  upsertUser,
} from './users'

// ─── Rate limiting (explicit helpers — used by Session 2 scan route) ──────────
export { getRateLimit, decrementRateLimit, resetStaleLimits } from './rate-limit'

// ─── Corrections ──────────────────────────────────────────────────────────────
export { insertCorrection } from './corrections'
export type { InsertCorrectionInput } from './corrections'

// ─── Training pipeline ────────────────────────────────────────────────────────
export {
  TRAINING_TRIGGER_THRESHOLD,
  insertTrainingExample,
  getUntrainedExamples,
  getUntrainedExampleCount,
  getActiveTrainingRun,
  insertTrainingRun,
  createTrainingRun,
  updateTrainingRun,
  activateTrainingRun,
  pruneOldGenerations,
  markExamplesTrained,
} from './training'

// ─── Types re-exported for callers ────────────────────────────────────────────
export type { InsertTrainingExampleInput, PruneResult } from '../types/db'

// ─── Raw DB row types (for internal helpers and tests) ───────────────────────
export type {
  Database,
  CardRow,      CardInsert,         CardUpdate,
  PriceCacheRow, PriceCacheInsert,  PriceCacheUpdate,
  ScanLogRow,   ScanLogInsert,      ScanLogUpdate,
  UserRow,      UserInsert,         UserUpdate,
  CorrectionRow, CorrectionInsert,  CorrectionUpdate,
  TrainingExampleRow, TrainingExampleInsert, TrainingExampleUpdate,
  TrainingRunRow,     TrainingRunInsert,     TrainingRunUpdate,
  SportValue,
  GradeCompanyValue,
  PlanTierValue,
  TrainingSourceValue,
  TrainingStatusValue,
} from './schema'
