/**
 * extension/src/background.ts
 *
 * CardSnap MV3 background service worker.
 *
 * Responsibilities:
 *   - Read/clear the Supabase JWT from chrome.storage.local
 *   - Handle CAPTURE_FRAME: validate JWT → POST /api/scan → relay result
 *   - Handle GET_STATUS: check JWT validity → send STATUS
 *   - Handle SIGN_IN / SIGN_OUT: Supabase email + password session in storage
 *   - Handle SUBMIT_CORRECTION: POST /api/scan/correct
 *
 * MV3 rule: never cache state in module-level variables — read from
 * chrome.storage.local on every message because the worker can be killed
 * and restarted between invocations.
 */

import type { InboundMessage, OutboundMessage } from './types';

const API_BASE = __API_BASE__;
const JWT_KEY = 'cardsnap_jwt';
const REFRESH_KEY = 'cardsnap_refresh';
const EXPIRY_BUFFER_SECONDS = 60;

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

interface JwtPayload {
  sub: string;
  exp: number;
  [key: string]: unknown;
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const raw = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(raw);
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

function isTokenValid(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return payload.exp - nowSeconds > EXPIRY_BUFFER_SECONDS;
}

async function getValidJwt(): Promise<{ token: string; payload: JwtPayload } | null> {
  const result = await chrome.storage.local.get([JWT_KEY, REFRESH_KEY]);
  let token = result[JWT_KEY] as string | undefined;
  if (!token || !isTokenValid(token)) {
    const refresh = result[REFRESH_KEY] as string | undefined;
    if (!refresh) return null;
    const renewed = await supabaseAuth('refresh_token', { refresh_token: refresh });
    if (!renewed.ok) return null;
    token = renewed.token;
  }
  const payload = decodeJwtPayload(token);
  return payload ? { token, payload } : null;
}

type AuthOutcome = { ok: true; token: string } | { ok: false; message: string };

/** Supabase GoTrue: grant 'password' or 'refresh_token' on /token, or 'signup'. Stores the session. */
async function supabaseAuth(
  grant: 'password' | 'refresh_token' | 'signup',
  body: Record<string, string>,
): Promise<AuthOutcome> {
  const url =
    grant === 'signup'
      ? `${__SUPABASE_URL__}/auth/v1/signup`
      : `${__SUPABASE_URL__}/auth/v1/token?grant_type=${grant}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: __SUPABASE_ANON_KEY__ },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network request failed' };
  }
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    msg?: string;
    error_description?: string;
  };
  if (!res.ok) {
    return { ok: false, message: data.error_description ?? data.msg ?? `Sign-in failed (HTTP ${res.status})` };
  }
  if (!data.access_token || !data.refresh_token) {
    // Signup with email confirmation on returns no session until the link is clicked.
    return { ok: false, message: 'Account created. Confirm it from the email, then sign in.' };
  }
  await chrome.storage.local.set({ [JWT_KEY]: data.access_token, [REFRESH_KEY]: data.refresh_token });
  return { ok: true, token: data.access_token };
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: InboundMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: OutboundMessage) => void,
  ): true => {
    handleMessage(message, sendResponse);
    return true; // keep channel open for async response
  },
);

async function handleMessage(
  message: InboundMessage,
  sendResponse: (response: OutboundMessage) => void,
): Promise<void> {
  switch (message.type) {
    case 'CAPTURE_FRAME':
      await handleCaptureFrame(message.imageBase64, sendResponse);
      break;

    case 'GET_STATUS':
      await handleGetStatus(sendResponse);
      break;

    case 'SIGN_OUT':
      await chrome.storage.local.remove([JWT_KEY, REFRESH_KEY]);
      break;

    case 'SIGN_IN': {
      const outcome = await supabaseAuth(message.create ? 'signup' : 'password', {
        email: message.email,
        password: message.password,
      });
      sendResponse({ type: 'AUTH_RESULT', ok: outcome.ok, message: outcome.ok ? 'Signed in' : outcome.message });
      break;
    }

    case 'SUBMIT_CORRECTION':
      await handleSubmitCorrection(message.scanId, message.correctedName, sendResponse);
      break;
  }
}

// ---------------------------------------------------------------------------
// CAPTURE_FRAME
// ---------------------------------------------------------------------------

async function handleCaptureFrame(
  imageBase64: string,
  sendResponse: (response: OutboundMessage) => void,
): Promise<void> {
  const auth = await getValidJwt();
  if (!auth) {
    sendResponse({ type: 'AUTH_REQUIRED' });
    return;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({
        image: imageBase64,
        userId: auth.payload.sub,
      }),
    });
  } catch (err) {
    sendResponse({
      type: 'SCAN_ERROR',
      code: 'NETWORK_ERROR',
      message: err instanceof Error ? err.message : 'Network request failed',
    });
    return;
  }

  if (response.status === 429) {
    sendResponse({ type: 'RATE_LIMIT_EXCEEDED', remaining: 0 });
    return;
  }

  if (response.status === 401 || response.status === 403) {
    sendResponse({ type: 'AUTH_REQUIRED' });
    return;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    sendResponse({
      type: 'SCAN_ERROR',
      code: 'PARSE_ERROR',
      message: 'Failed to parse API response',
    });
    return;
  }

  const apiResponse = body as { success: boolean; data?: unknown; error?: string; code?: string };

  if (!apiResponse.success) {
    sendResponse({
      type: 'SCAN_ERROR',
      code: apiResponse.code ?? 'UNKNOWN_ERROR',
      message: apiResponse.error ?? 'Unknown error from scan API',
    });
    return;
  }

  sendResponse({
    type: 'SCAN_RESULT',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: apiResponse.data as any,
  });
}

// ---------------------------------------------------------------------------
// GET_STATUS
// ---------------------------------------------------------------------------

async function handleGetStatus(
  sendResponse: (response: OutboundMessage) => void,
): Promise<void> {
  if (!(await getValidJwt())) {
    sendResponse({ type: 'STATUS', authenticated: false });
    return;
  }

  sendResponse({ type: 'STATUS', authenticated: true });
}

// ---------------------------------------------------------------------------
// SUBMIT_CORRECTION
// ---------------------------------------------------------------------------

async function handleSubmitCorrection(
  scanId: string,
  correctedName: string,
  sendResponse: (response: OutboundMessage) => void,
): Promise<void> {
  const auth = await getValidJwt();
  if (!auth) {
    sendResponse({ type: 'AUTH_REQUIRED' });
    return;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/scan/correct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({ scan_id: scanId, corrected_name: correctedName }),
    });
  } catch (err) {
    sendResponse({
      type: 'SCAN_ERROR',
      code: 'NETWORK_ERROR',
      message: err instanceof Error ? err.message : 'Correction request failed',
    });
    return;
  }

  if (response.status === 401 || response.status === 403) {
    sendResponse({ type: 'AUTH_REQUIRED' });
    return;
  }

  if (!response.ok) {
    let errBody: { error?: string; code?: string } = {};
    try {
      errBody = (await response.json()) as typeof errBody;
    } catch {
      // ignore parse failure
    }
    sendResponse({
      type: 'SCAN_ERROR',
      code: errBody.code ?? 'CORRECTION_FAILED',
      message: errBody.error ?? `Correction failed with status ${response.status}`,
    });
  }
}
