/**
 * extension/src/content.ts
 *
 * Injected into stream platform tabs. Shift+S captures the current video
 * frame, sends it to the background service worker, and shows the result in a
 * box over the stream with the time it took and a right/wrong tally for the
 * live test. Nothing is stored; the tally resets when the page reloads.
 */

import type { InboundMessage, OutboundMessage, ScanResultPayload } from './types';

const PASS_SECONDS = 5;

// ---------------------------------------------------------------------------
// Visual feedback
// ---------------------------------------------------------------------------

function flashVideo(video: HTMLVideoElement): void {
  const prev = video.style.outline;
  video.style.outline = '3px solid #00e5ff';
  setTimeout(() => {
    video.style.outline = prev;
  }, 200);
}

// ---------------------------------------------------------------------------
// Result box (shadow DOM so the stream page's CSS can't touch it)
// ---------------------------------------------------------------------------

const tally = { right: 0, wrong: 0, fast: 0 };
let host: HTMLDivElement | null = null;
let root: ShadowRoot | null = null;
let scanning = false;

const BOX_CSS = `
  .box { position: fixed; top: 16px; right: 16px; width: 300px; z-index: 2147483647;
    background: #111; color: #e4e4e7; border: 1px solid #3f3f46; border-radius: 10px;
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding: 12px 14px; box-shadow: 0 8px 24px rgba(0,0,0,.5); }
  .name { font-size: 15px; font-weight: 600; color: #f4f4f5; }
  .sub { color: #71717a; font-size: 12px; margin-top: 2px; }
  .price { font-size: 26px; font-weight: 700; color: #f97316; margin-top: 8px; }
  .unsure { font-size: 16px; font-weight: 700; color: #facc15; margin-top: 8px; }
  .err { color: #f87171; font-weight: 600; }
  .attr { color: #52525b; font-size: 11px; }
  .card { display: block; width: 100%; margin-top: 8px; border-radius: 8px; }
  .row { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; gap: 8px; }
  .time.pass { color: #4ade80; } .time.fail { color: #f87171; }
  button { background: #27272a; color: #e4e4e7; border: 1px solid #3f3f46; border-radius: 6px;
    padding: 4px 10px; cursor: pointer; font: inherit; }
  button:hover { background: #3f3f46; }
  .tally { color: #a1a1aa; font-size: 12px; }
  .x { background: none; border: none; color: #71717a; padding: 0 2px; }
`;

function ensureBox(): ShadowRoot {
  // Follow the video into fullscreen, where document.body is hidden.
  const parent = document.fullscreenElement ?? document.body;
  if (!host || !root) {
    host = document.createElement('div');
    root = host.attachShadow({ mode: 'open' });
  }
  if (host.parentElement !== parent) parent.appendChild(host);
  return root;
}

function tallyText(): string {
  const n = tally.right + tally.wrong;
  return n === 0 ? 'Tally: none yet' : `Right ${tally.right}/${n} · under ${PASS_SECONDS}s ${tally.fast}/${n}`;
}

function render(inner: string, graded: { fast: boolean } | null): void {
  const r = ensureBox();
  r.innerHTML = `<style>${BOX_CSS}</style><div class="box">${inner}
    <div class="row">
      ${graded ? '<span><button data-g="right">Right</button> <button data-g="wrong">Wrong</button></span>' : '<span></span>'}
      <span class="tally">${tallyText()}</span>
      <button class="x" data-g="close" title="Close">✕</button>
    </div></div>`;
  r.querySelectorAll<HTMLButtonElement>('button[data-g]').forEach((b) => {
    b.addEventListener('click', () => {
      const g = b.dataset.g;
      if (g === 'close') {
        host?.remove();
        return;
      }
      if (g === 'right') tally.right += 1;
      if (g === 'wrong') tally.wrong += 1;
      if (graded?.fast) tally.fast += 1;
      r.querySelectorAll('button[data-g="right"], button[data-g="wrong"]').forEach((x) => x.remove());
      r.querySelector('.tally')!.textContent = tallyText();
    });
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function money(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function renderResult(data: ScanResultPayload, seconds: number): void {
  const c = data.card;
  const fast = seconds <= PASS_SECONDS;
  const read = [c.set_name, c.card_number && `#${c.card_number}`, c.finish !== 'normal' && c.finish.replace('_', ' ')]
    .filter(Boolean)
    .join(' · ');
  // Several printings and none picked: showing one would be a random printing's card and price.
  const n = data.printings ?? 0;
  const ambiguous = data.needs_confirmation && n > 1;
  const m = ambiguous ? null : data.matched_card;
  const matched = ambiguous
    ? `<b>${n} printings of ${esc(data.matched_card?.name ?? c.card_name)}, ${c.card_number ? `#${esc(c.card_number)} didn't settle it` : 'number not read'}</b>`
    : m
      ? `<b>Matched: ${esc(m.name)} · ${esc(m.set_name ?? m.set_id)} #${esc(m.local_id)}</b>`
      : 'No catalog match';
  const priceLine = ambiguous
    ? `<div class="unsure">No price until the number is read</div>`
    : data.pricing && !data.needs_confirmation
      ? `<div class="price">${money(data.pricing.avg_sold_price)}</div><div class="attr">${esc(data.pricing.attribution)}</div>`
      : data.pricing
        ? `<div class="unsure">Unsure match · ${money(data.pricing.avg_sold_price)}?</div><div class="attr">${esc(data.pricing.attribution)}</div>`
        : `<div class="unsure">Unsure · no price</div>`;
  render(
    `<div class="name">${esc(c.card_name)}</div>
     <div class="sub">Read: ${esc(read || 'set not read')}</div>
     <div class="sub">${matched}</div>
     ${m && data.stamped_reprint ? `<div class="sub" style="color:#facc15">Logo stamp on it? Then it's ${esc(data.stamped_reprint)}</div>` : ''}
     ${m?.image_url ? `<img class="card" src="${esc(m.image_url)}" alt="Matched card">` : ''}
     ${priceLine}
     <div class="row"><span class="time ${fast ? 'pass' : 'fail'}">${seconds.toFixed(1)}s</span></div>`,
    { fast },
  );
}

function renderMessage(text: string, isError: boolean): void {
  render(`<div class="${isError ? 'err' : 'name'}">${esc(text)}</div>`, null);
}

// ---------------------------------------------------------------------------
// Video selection
// ---------------------------------------------------------------------------

function findVideo(): HTMLVideoElement | null {
  const all = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
  if (all.length === 0) return null;
  const ready = all.filter((v) => !v.paused && v.readyState >= 2);
  return ready[0] ?? all[0] ?? null;
}

// ---------------------------------------------------------------------------
// Frame capture
// ---------------------------------------------------------------------------

function captureFrame(): void {
  const video = findVideo();
  if (!video) {
    renderMessage('No video found on this page.', true);
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let dataUrl: string;
  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'SecurityError') {
      renderMessage('Capture blocked: this player does not allow reading frames.', true);
      return;
    }
    throw err;
  }

  if (dataUrl === 'data:,') {
    renderMessage('Blank frame: the stream is DRM-protected or not playing.', true);
    return;
  }

  const prefix = 'data:image/jpeg;base64,';
  const imageBase64 = dataUrl.startsWith(prefix) ? dataUrl.slice(prefix.length) : dataUrl;

  flashVideo(video);
  renderMessage('Scanning...', false);
  const started = performance.now();
  scanning = true;

  const msg: InboundMessage = { type: 'CAPTURE_FRAME', imageBase64 };
  chrome.runtime.sendMessage(msg, (response: OutboundMessage | undefined) => {
    scanning = false;
    const seconds = (performance.now() - started) / 1000;
    if (!response) {
      renderMessage('Extension not responding. Reload the extension and this page.', true);
      return;
    }
    switch (response.type) {
      case 'SCAN_RESULT':
        renderResult(response.data, seconds);
        break;
      case 'AUTH_REQUIRED':
        renderMessage('Sign in first: click the CardSnap icon in the toolbar.', true);
        break;
      case 'RATE_LIMIT_EXCEEDED':
        renderMessage('Daily scan limit reached.', true);
        break;
      case 'SCAN_ERROR':
        renderMessage(`${response.code}: ${response.message}`, true);
        break;
    }
  });
}

// ---------------------------------------------------------------------------
// Hotkey listener
// ---------------------------------------------------------------------------

window.addEventListener(
  'keydown',
  (e: KeyboardEvent) => {
    if (e.shiftKey && e.key === 'S') {
      // Holding the keys auto-repeats; one press is one scan (each costs credits).
      if (e.repeat || scanning) {
        e.stopImmediatePropagation();
        return;
      }
      const t = e.target as HTMLElement | null;
      // Don't hijack typing a capital S in chat.
      if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.stopImmediatePropagation();
      captureFrame();
    }
  },
  { capture: true },
);
