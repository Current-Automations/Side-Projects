"use strict";
(() => {
  // extension/src/popup.ts
  var currentScanId = null;
  function el(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Missing element #${id}`);
    return node;
  }
  var STATES = ["state-loading", "state-result", "state-rate-limit", "state-auth", "state-error"];
  function showState(state) {
    for (const s of STATES) {
      el(s).classList.toggle("hidden", s !== state);
    }
  }
  function formatPrice(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
  }
  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return iso;
    }
  }
  function buildCardLabel(card) {
    const parts = [
      String(card.year),
      card.manufacturer,
      card.product_line
    ];
    if (card.set_variant) parts.push(card.set_variant);
    parts.push(card.player_name);
    if (card.parallel_name && card.parallel_name !== "Base") parts.push(card.parallel_name);
    if (card.card_number) parts.push(`#${card.card_number}`);
    if (card.is_graded && card.grade_company) {
      parts.push(`${card.grade_company}${card.grade_value ? " " + card.grade_value : ""}`);
    }
    return parts.join(" ");
  }
  function renderTrend(trend, badge) {
    if (!trend) {
      badge.classList.add("hidden");
      return;
    }
    const labels = { up: "\u2191 Up", down: "\u2193 Down", stable: "\u2192 Stable", new: "New" };
    badge.textContent = labels[trend] ?? trend;
    badge.className = `trend trend-${trend}`;
  }
  function renderResult(data) {
    currentScanId = data.scan_id;
    el("result-card-name").textContent = buildCardLabel(data.card);
    const pricing = data.pricing;
    if (pricing) {
      el("result-price").textContent = formatPrice(pricing.avg_sold_price);
      el("result-attribution").textContent = pricing.attribution;
      const salesBlock = el("sales-block");
      const salesList = el("result-sales");
      salesList.innerHTML = "";
      if (pricing.last_10_sales.length > 0) {
        for (const sale of pricing.last_10_sales.slice(0, 5)) {
          const li = document.createElement("li");
          li.className = "sale-item";
          const priceSpan = document.createElement("span");
          priceSpan.className = "sale-price";
          priceSpan.textContent = formatPrice(sale.price);
          const dateSpan = document.createElement("span");
          dateSpan.className = "sale-date";
          dateSpan.textContent = formatDate(sale.date);
          li.appendChild(priceSpan);
          li.appendChild(dateSpan);
          salesList.appendChild(li);
        }
        salesBlock.classList.remove("hidden");
      } else {
        salesBlock.classList.add("hidden");
      }
      renderTrend(data.trend, el("result-trend"));
    } else {
      el("result-price").textContent = "N/A";
      el("result-attribution").textContent = "";
      el("sales-block").classList.add("hidden");
      el("result-trend").classList.add("hidden");
    }
    const scansEl = el("result-scans");
    if (data.remaining_scans === null) {
      scansEl.textContent = "";
      scansEl.innerHTML = "";
      const strong = document.createElement("strong");
      strong.textContent = "Unlimited";
      scansEl.appendChild(document.createTextNode("Scans remaining: "));
      scansEl.appendChild(strong);
      scansEl.classList.remove("hidden");
    } else if (typeof data.remaining_scans === "number") {
      scansEl.textContent = "";
      const strong = document.createElement("strong");
      strong.textContent = String(data.remaining_scans);
      scansEl.appendChild(document.createTextNode("Scans remaining today: "));
      scansEl.appendChild(strong);
      scansEl.classList.remove("hidden");
    } else {
      scansEl.classList.add("hidden");
    }
    showState("state-result");
    hideCorrectionForm();
  }
  function errorDisplay(code, raw) {
    switch (code) {
      case "NO_VIDEO":
        return { title: "No video found", body: "Navigate to a page with a video stream and try again." };
      case "CAPTURE_BLOCKED":
        return { title: "Capture blocked", body: "The page prevented screen capture. Try a different tab or video source." };
      case "CAPTURE_BLANK":
        return { title: "Blank frame captured", body: "The captured frame was empty. Make sure the video is playing." };
      case "NETWORK_ERROR":
        return { title: "Connection error", body: "Could not reach the CardSnap API. Check your internet connection." };
      case "PARSE_ERROR":
        return { title: "Unexpected response", body: "The API returned an unreadable response. Try again." };
      default:
        return { title: "Something went wrong", body: raw || "An unexpected error occurred." };
    }
  }
  function renderError(code, message) {
    const { title, body } = errorDisplay(code, message);
    el("error-title").textContent = title;
    el("error-body").textContent = body;
    showState("state-error");
  }
  function showCorrectionForm() {
    el("state-correction").classList.remove("hidden");
    el("result-main").classList.add("hidden");
    const input = el("correction-input");
    input.value = el("result-card-name").textContent ?? "";
    input.focus();
    input.select();
  }
  function hideCorrectionForm() {
    el("state-correction").classList.add("hidden");
    el("result-main").classList.remove("hidden");
  }
  function submitCorrection(correctedName) {
    if (!currentScanId) return;
    const btn = el("btn-submit-correction");
    btn.disabled = true;
    btn.textContent = "Submitting...";
    const msg = {
      type: "SUBMIT_CORRECTION",
      scanId: currentScanId,
      correctedName
    };
    chrome.runtime.sendMessage(msg, (response) => {
      btn.disabled = false;
      btn.textContent = "Submit";
      if (!response) {
        renderError("UNKNOWN_ERROR", "No response from background.");
        return;
      }
      handleOutbound(response);
    });
  }
  function handleOutbound(msg) {
    switch (msg.type) {
      case "SCAN_RESULT":
        renderResult(msg.data);
        break;
      case "SCAN_ERROR":
        renderError(msg.code, msg.message);
        break;
      case "AUTH_REQUIRED":
        showState("state-auth");
        break;
      case "RATE_LIMIT_EXCEEDED":
        showState("state-rate-limit");
        break;
      case "STATUS":
        if (!msg.authenticated) {
          showState("state-auth");
        } else {
          el("state-loading").querySelector(".loading-text").textContent = "Press the hotkey on a card to scan.";
          showState("state-loading");
          el("state-loading").querySelector(".spinner").style.display = "none";
        }
        break;
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    el("btn-open-correction").addEventListener("click", showCorrectionForm);
    el("btn-cancel-correction").addEventListener("click", hideCorrectionForm);
    el("correction-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = el("correction-input");
      const name = input.value.trim();
      if (name) submitCorrection(name);
    });
    chrome.runtime.onMessage.addListener((msg) => {
      handleOutbound(msg);
      return false;
    });
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
      if (!response) {
        renderError("UNKNOWN_ERROR", "Background worker not responding.");
        return;
      }
      handleOutbound(response);
    });
  });
})();
