# ADR: ISSUE-01 — Screenshot Capture Spike

**Date:** 2026-06-21
**Status:** Decided

---

## Context

CardSnap needs to capture a frame from a live `<video>` element in a stream platform tab when the user presses a hotkey. The question was whether a Chrome extension content script can do this via `drawImage()` on an off-screen `<canvas>`, or whether cross-origin/DRM restrictions would block it.

---

## Testing

A minimal MV3 spike extension was built (`extension-spike/`) with:
- A content script injecting on Whatnot, TikTok, and Instagram
- A `Shift+S` hotkey listener using `capture: true` on `window` (required — stream players capture keyboard events before `document` listeners fire)
- `drawImage()` onto a canvas, with `toDataURL('image/jpeg', 0.85)` to extract the frame
- Overlay UI showing result (success / blank canvas / error)

**Note on hotkey:** `window.addEventListener('keydown', handler, true)` with `e.stopImmediatePropagation()` is required. `document.addEventListener` without capture fails silently on all tested platforms — the player intercepts the event first.

---

## Results

| Platform | Result | Notes |
|---|---|---|
| Whatnot | ✅ SUCCESS | Canvas capture works. Frame extracted as JPEG. |
| TikTok Live | Not tested yet | Test when a live is available |
| Instagram Live | Not tested yet | Test when a live is available |

---

## Decision

**Proceed with canvas capture via content script.** Whatnot — the primary target platform — works. The MV3 content script approach is viable.

The build will proceed with:
- `window.addEventListener('keydown', handler, { capture: true })` for hotkey interception
- `drawImage()` + `toDataURL()` for frame extraction
- TikTok and Instagram to be tested during ISSUE-12 implementation; if either fails, fall back to `navigator.mediaDevices.getDisplayMedia()` or mark as unsupported

---

## Files

- Spike extension: `extension-spike/` (local only, not part of production build)
- Production extension scaffold: ISSUE-10
