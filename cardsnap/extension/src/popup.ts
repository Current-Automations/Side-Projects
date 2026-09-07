/**
 * extension/src/popup.ts
 *
 * Popup UI logic for the CardSnap extension.
 * Communicates with the background service worker via chrome.runtime.sendMessage.
 * No frameworks — vanilla TypeScript + DOM APIs only.
 */

import type { InboundMessage, OutboundMessage, ScanResultPayload } from './types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentScanId: string | null = null;

// ---------------------------------------------------------------------------
// DOM refs — grabbed once after DOMContentLoaded
// ---------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

// ---------------------------------------------------------------------------
// Show / hide helpers
// ---------------------------------------------------------------------------

const STATES = ['state-loading', 'state-result', 'state-rate-limit', 'state-auth', 'state-error'] as const;

function showState(state: typeof STATES[number]): void {
  for (const s of STATES) {
    el(s).classList.toggle('hidden', s !== state);
  }
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function formatPrice(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function buildCardLabel(card: ScanResultPayload['card']): string {
  const parts: string[] = [
    String(card.year),
    card.manufacturer,
    card.product_line,
  ];
  if (card.set_variant) parts.push(card.set_variant);
  parts.push(card.player_name);
  if (card.parallel_name && card.parallel_name !== 'Base') parts.push(card.parallel_name);
  if (card.card_number) parts.push(`#${card.card_number}`);
  if (card.is_graded && card.grade_company) {
    parts.push(`${card.grade_company}${card.grade_value ? ' ' + card.grade_value : ''}`);
  }
  return parts.join(' ');
}

function renderTrend(trend: ScanResultPayload['trend'], badge: HTMLElement): void {
  if (!trend) {
    badge.classList.add('hidden');
    return;
  }
  const labels: Record<string, string> = { up: '↑ Up', down: '↓ Down', stable: '→ Stable', new: 'New' };
  badge.textContent = labels[trend] ?? trend;
  badge.className = `trend trend-${trend}`;
}

function renderResult(data: ScanResultPayload): void {
  currentScanId = data.scan_id;

  el('result-card-name').textContent = buildCardLabel(data.card);

  const pricing = data.pricing;
  if (pricing) {
    el('result-price').textContent = formatPrice(pricing.avg_sold_price);
    el('result-attribution').textContent = pricing.attribution;

    const salesBlock = el('sales-block');
    const salesList = el('result-sales');
    salesList.innerHTML = '';
    if (pricing.last_10_sales.length > 0) {
      for (const sale of pricing.last_10_sales.slice(0, 5)) {
        const li = document.createElement('li');
        li.className = 'sale-item';
        const priceSpan = document.createElement('span');
        priceSpan.className = 'sale-price';
        priceSpan.textContent = formatPrice(sale.price);
        const dateSpan = document.createElement('span');
        dateSpan.className = 'sale-date';
        dateSpan.textContent = formatDate(sale.date);
        li.appendChild(priceSpan);
        li.appendChild(dateSpan);
        salesList.appendChild(li);
      }
      salesBlock.classList.remove('hidden');
    } else {
      salesBlock.classList.add('hidden');
    }

    renderTrend(data.trend, el('result-trend'));
  } else {
    el('result-price').textContent = 'N/A';
    el('result-attribution').textContent = '';
    el('sales-block').classList.add('hidden');
    el('result-trend').classList.add('hidden');
  }

  const scansEl = el('result-scans');
  if (data.remaining_scans === null) {
    scansEl.textContent = '';
    scansEl.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = 'Unlimited';
    scansEl.appendChild(document.createTextNode('Scans remaining: '));
    scansEl.appendChild(strong);
    scansEl.classList.remove('hidden');
  } else if (typeof data.remaining_scans === 'number') {
    scansEl.textContent = '';
    const strong = document.createElement('strong');
    strong.textContent = String(data.remaining_scans);
    scansEl.appendChild(document.createTextNode('Scans remaining today: '));
    scansEl.appendChild(strong);
    scansEl.classList.remove('hidden');
  } else {
    scansEl.classList.add('hidden');
  }

  showState('state-result');
  hideCorrectionForm();
}

// ---------------------------------------------------------------------------
// Error codes → human strings
// ---------------------------------------------------------------------------

interface ErrorDisplay { title: string; body: string; }

function errorDisplay(code: string, raw: string): ErrorDisplay {
  switch (code) {
    case 'NO_VIDEO':
      return { title: 'No video found', body: 'Navigate to a page with a video stream and try again.' };
    case 'CAPTURE_BLOCKED':
      return { title: 'Capture blocked', body: 'The page prevented screen capture. Try a different tab or video source.' };
    case 'CAPTURE_BLANK':
      return { title: 'Blank frame captured', body: 'The captured frame was empty. Make sure the video is playing.' };
    case 'NETWORK_ERROR':
      return { title: 'Connection error', body: 'Could not reach the CardSnap API. Check your internet connection.' };
    case 'PARSE_ERROR':
      return { title: 'Unexpected response', body: 'The API returned an unreadable response. Try again.' };
    default:
      return { title: 'Something went wrong', body: raw || 'An unexpected error occurred.' };
  }
}

function renderError(code: string, message: string): void {
  const { title, body } = errorDisplay(code, message);
  el('error-title').textContent = title;
  el('error-body').textContent = body;
  showState('state-error');
}

// ---------------------------------------------------------------------------
// Correction form
// ---------------------------------------------------------------------------

function showCorrectionForm(): void {
  el('state-correction').classList.remove('hidden');
  el('result-main').classList.add('hidden');
  const input = el<HTMLInputElement>('correction-input');
  input.value = el('result-card-name').textContent ?? '';
  input.focus();
  input.select();
}

function hideCorrectionForm(): void {
  el('state-correction').classList.add('hidden');
  el('result-main').classList.remove('hidden');
}

function submitCorrection(correctedName: string): void {
  if (!currentScanId) return;
  const btn = el<HTMLButtonElement>('btn-submit-correction');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  const msg: InboundMessage = {
    type: 'SUBMIT_CORRECTION',
    scanId: currentScanId,
    correctedName,
  };

  chrome.runtime.sendMessage(msg, (response: OutboundMessage) => {
    btn.disabled = false;
    btn.textContent = 'Submit';
    if (!response) {
      renderError('UNKNOWN_ERROR', 'No response from background.');
      return;
    }
    handleOutbound(response);
  });
}

// ---------------------------------------------------------------------------
// Outbound message router
// ---------------------------------------------------------------------------

function handleOutbound(msg: OutboundMessage): void {
  switch (msg.type) {
    case 'SCAN_RESULT':
      renderResult(msg.data);
      break;
    case 'SCAN_ERROR':
      renderError(msg.code, msg.message);
      break;
    case 'AUTH_REQUIRED':
      showState('state-auth');
      break;
    case 'RATE_LIMIT_EXCEEDED':
      showState('state-rate-limit');
      break;
    case 'STATUS':
      if (!msg.authenticated) {
        showState('state-auth');
      } else {
        // Authenticated — wait for a scan result pushed by content script
        // Show idle ready state (reuse loading container with different text)
        el<HTMLElement>('state-loading').querySelector<HTMLElement>('.loading-text')!.textContent =
          'Press the hotkey on a card to scan.';
        showState('state-loading');
        el('state-loading').querySelector<HTMLElement>('.spinner')!.style.display = 'none';
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  // Wire up correction form
  el('btn-open-correction').addEventListener('click', showCorrectionForm);
  el('btn-cancel-correction').addEventListener('click', hideCorrectionForm);
  el('correction-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = el<HTMLInputElement>('correction-input');
    const name = input.value.trim();
    if (name) submitCorrection(name);
  });

  // Listen for pushed messages (e.g. scan result from content script relay)
  chrome.runtime.onMessage.addListener((msg: OutboundMessage) => {
    handleOutbound(msg);
    return false;
  });

  // On open: get current auth/plan status
  chrome.runtime.sendMessage({ type: 'GET_STATUS' } satisfies InboundMessage, (response: OutboundMessage) => {
    if (!response) {
      renderError('UNKNOWN_ERROR', 'Background worker not responding.');
      return;
    }
    handleOutbound(response);
  });
});
