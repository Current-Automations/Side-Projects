// extension/src/background.ts
var API_BASE = "https://cardsnap.app";
var JWT_KEY = "cardsnap_jwt";
var EXPIRY_BUFFER_SECONDS = 60;
function decodeJwtPayload(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const raw = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(raw);
    return JSON.parse(json);
  } catch {
    return null;
  }
}
function isTokenValid(token) {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  const nowSeconds = Math.floor(Date.now() / 1e3);
  return payload.exp - nowSeconds > EXPIRY_BUFFER_SECONDS;
}
async function getValidJwt() {
  const result = await chrome.storage.local.get(JWT_KEY);
  const token = result[JWT_KEY];
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const nowSeconds = Math.floor(Date.now() / 1e3);
  if (payload.exp - nowSeconds <= EXPIRY_BUFFER_SECONDS) return null;
  return { token, payload };
}
chrome.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {
    handleMessage(message, sendResponse);
    return true;
  }
);
async function handleMessage(message, sendResponse) {
  switch (message.type) {
    case "CAPTURE_FRAME":
      await handleCaptureFrame(message.imageBase64, sendResponse);
      break;
    case "GET_STATUS":
      await handleGetStatus(sendResponse);
      break;
    case "SIGN_OUT":
      await chrome.storage.local.remove(JWT_KEY);
      break;
    case "SUBMIT_CORRECTION":
      await handleSubmitCorrection(message.scanId, message.correctedName, sendResponse);
      break;
  }
}
async function handleCaptureFrame(imageBase64, sendResponse) {
  const auth = await getValidJwt();
  if (!auth) {
    sendResponse({ type: "AUTH_REQUIRED" });
    return;
  }
  let response;
  try {
    response = await fetch(`${API_BASE}/api/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`
      },
      body: JSON.stringify({
        image: imageBase64,
        userId: auth.payload.sub
      })
    });
  } catch (err) {
    sendResponse({
      type: "SCAN_ERROR",
      code: "NETWORK_ERROR",
      message: err instanceof Error ? err.message : "Network request failed"
    });
    return;
  }
  if (response.status === 429) {
    sendResponse({ type: "RATE_LIMIT_EXCEEDED", remaining: 0 });
    return;
  }
  if (response.status === 401 || response.status === 403) {
    sendResponse({ type: "AUTH_REQUIRED" });
    return;
  }
  let body;
  try {
    body = await response.json();
  } catch {
    sendResponse({
      type: "SCAN_ERROR",
      code: "PARSE_ERROR",
      message: "Failed to parse API response"
    });
    return;
  }
  const apiResponse = body;
  if (!apiResponse.success) {
    sendResponse({
      type: "SCAN_ERROR",
      code: apiResponse.code ?? "UNKNOWN_ERROR",
      message: apiResponse.error ?? "Unknown error from scan API"
    });
    return;
  }
  sendResponse({
    type: "SCAN_RESULT",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: apiResponse.data
  });
}
async function handleGetStatus(sendResponse) {
  const result = await chrome.storage.local.get(JWT_KEY);
  const token = result[JWT_KEY];
  if (!token || !isTokenValid(token)) {
    sendResponse({ type: "STATUS", authenticated: false });
    return;
  }
  sendResponse({ type: "STATUS", authenticated: true });
}
async function handleSubmitCorrection(scanId, correctedName, sendResponse) {
  const auth = await getValidJwt();
  if (!auth) {
    sendResponse({ type: "AUTH_REQUIRED" });
    return;
  }
  let response;
  try {
    response = await fetch(`${API_BASE}/api/scan/correct`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`
      },
      body: JSON.stringify({ scan_id: scanId, corrected_name: correctedName })
    });
  } catch (err) {
    sendResponse({
      type: "SCAN_ERROR",
      code: "NETWORK_ERROR",
      message: err instanceof Error ? err.message : "Correction request failed"
    });
    return;
  }
  if (response.status === 401 || response.status === 403) {
    sendResponse({ type: "AUTH_REQUIRED" });
    return;
  }
  if (!response.ok) {
    let errBody = {};
    try {
      errBody = await response.json();
    } catch {
    }
    sendResponse({
      type: "SCAN_ERROR",
      code: errBody.code ?? "CORRECTION_FAILED",
      message: errBody.error ?? `Correction failed with status ${response.status}`
    });
  }
}
