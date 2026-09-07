"use strict";
(() => {
  // extension/src/content.ts
  function flashVideo(video) {
    const prev = video.style.outline;
    video.style.outline = "3px solid #00e5ff";
    setTimeout(() => {
      video.style.outline = prev;
    }, 200);
  }
  function findVideo() {
    const all = Array.from(document.querySelectorAll("video"));
    if (all.length === 0) return null;
    const ready = all.filter((v) => !v.paused && v.readyState >= 2);
    return ready[0] ?? all[0] ?? null;
  }
  function sendMessage(msg) {
    chrome.runtime.sendMessage(msg);
  }
  function captureFrame() {
    const video = findVideo();
    if (!video) {
      sendMessage({
        type: "SCAN_ERROR",
        code: "NO_VIDEO",
        message: "No video element found on this page"
      });
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch (err) {
      if (err instanceof DOMException && err.name === "SecurityError") {
        sendMessage({
          type: "SCAN_ERROR",
          code: "CAPTURE_BLOCKED",
          message: "Stream capture blocked by browser security policy"
        });
        return;
      }
      throw err;
    }
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    if (dataUrl === "data:,") {
      sendMessage({
        type: "SCAN_ERROR",
        code: "CAPTURE_BLANK",
        message: "Stream is DRM-protected \u2014 capture not possible"
      });
      return;
    }
    const prefix = "data:image/jpeg;base64,";
    const imageBase64 = dataUrl.startsWith(prefix) ? dataUrl.slice(prefix.length) : dataUrl;
    flashVideo(video);
    sendMessage({ type: "CAPTURE_FRAME", imageBase64 });
  }
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.shiftKey && e.key === "S") {
        e.stopImmediatePropagation();
        captureFrame();
      }
    },
    { capture: true }
  );
})();
