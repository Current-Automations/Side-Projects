/**
 * extension/src/content.ts
 *
 * Injected into stream platform tabs. Shift+S captures the current video
 * frame and sends it to the background service worker.
 */

import type { InboundMessage, OutboundMessage } from './types';

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

function sendMessage(msg: InboundMessage | OutboundMessage): void {
  chrome.runtime.sendMessage(msg);
}

function captureFrame(): void {
  const video = findVideo();

  if (!video) {
    sendMessage({
      type: 'SCAN_ERROR',
      code: 'NO_VIDEO',
      message: 'No video element found on this page',
    } as OutboundMessage);
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'SecurityError') {
      sendMessage({
        type: 'SCAN_ERROR',
        code: 'CAPTURE_BLOCKED',
        message: 'Stream capture blocked by browser security policy',
      } as OutboundMessage);
      return;
    }
    throw err;
  }

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

  if (dataUrl === 'data:,') {
    sendMessage({
      type: 'SCAN_ERROR',
      code: 'CAPTURE_BLANK',
      message: 'Stream is DRM-protected — capture not possible',
    } as OutboundMessage);
    return;
  }

  const prefix = 'data:image/jpeg;base64,';
  const imageBase64 = dataUrl.startsWith(prefix) ? dataUrl.slice(prefix.length) : dataUrl;

  flashVideo(video);

  sendMessage({ type: 'CAPTURE_FRAME', imageBase64 });
}

// ---------------------------------------------------------------------------
// Hotkey listener
// ---------------------------------------------------------------------------

window.addEventListener(
  'keydown',
  (e: KeyboardEvent) => {
    if (e.shiftKey && e.key === 'S') {
      e.stopImmediatePropagation();
      captureFrame();
    }
  },
  { capture: true },
);
