/**
 * extension/src/types.ts
 *
 * Message protocol types for communication between the content script,
 * popup, and background service worker.
 */

import type { ScanResult } from '../../lib/types/domain';

export type ScanResultPayload = ScanResult;

// ---------------------------------------------------------------------------
// Messages the background receives
// ---------------------------------------------------------------------------

export type InboundMessage =
  | { type: 'CAPTURE_FRAME'; imageBase64: string }
  | { type: 'GET_STATUS' }
  | { type: 'SIGN_OUT' }
  | { type: 'SUBMIT_CORRECTION'; scanId: string; correctedName: string };

// ---------------------------------------------------------------------------
// Messages the background sends
// ---------------------------------------------------------------------------

export type OutboundMessage =
  | { type: 'SCAN_RESULT'; data: ScanResultPayload }
  | { type: 'SCAN_ERROR'; code: string; message: string }
  | { type: 'AUTH_REQUIRED' }
  | { type: 'RATE_LIMIT_EXCEEDED'; remaining: 0 }
  | { type: 'STATUS'; authenticated: boolean; planTier?: string; remainingScans?: number | null };
