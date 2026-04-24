const STORAGE_KEYS = {
  apiBase: "apiBase",
  helperToken: "helperToken",
  helperLabel: "helperLabel",
  lastFingerprint: "lastFingerprint",
  lastSyncAt: "lastSyncAt",
  lastError: "lastError",
  lastAttemptAt: "lastAttemptAt",
  lastSyncSummary: "lastSyncSummary"
};

const apiBaseInput = document.getElementById("api-base");
const pairingCodeInput = document.getElementById("pairing-code");
const pairButton = document.getElementById("pair-helper");
const syncButton = document.getElementById("sync-now");
const forgetButton = document.getElementById("forget-helper");
const statusNode = document.getElementById("status");

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(payload) {
  return new Promise((resolve) => chrome.storage.local.set(payload, resolve));
}

function storageRemove(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

function normalizeApiBase(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/\/+$/, "");
}

function toOriginPattern(apiBase) {
  return `${new URL(normalizeApiBase(apiBase)).origin}/*`;
}

function permissionsRequest(permissions) {
  return new Promise((resolve) => chrome.permissions.request(permissions, resolve));
}

function runtimeSendMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

async function readState() {
  return storageGet(Object.values(STORAGE_KEYS));
}

function renderState(state, extraMessage = "") {
  apiBaseInput.value = state.apiBase || "";
  const lines = [
    state.helperLabel ? `Helper label: ${state.helperLabel}` : "Helper label: not paired",
    state.lastSyncAt ? `Last sync: ${new Date(state.lastSyncAt).toLocaleString()}` : "Last sync: never",
    state.lastAttemptAt
      ? `Last attempt: ${new Date(state.lastAttemptAt).toLocaleString()}`
      : "Last attempt: never",
    state.lastSyncSummary ? `Summary: ${state.lastSyncSummary}` : "Summary: no sync yet",
    state.lastError ? `Last error: ${state.lastError}` : "Last error: none"
  ];
  if (extraMessage) {
    lines.unshift(extraMessage);
  }
  statusNode.textContent = lines.join("\n");
}

async function refreshState(extraMessage = "") {
  const state = await readState();
  renderState(state, extraMessage);
}

async function pairHelper() {
  const apiBase = normalizeApiBase(apiBaseInput.value);
  const pairingCode = String(pairingCodeInput.value || "").trim();
  if (!apiBase) {
    await refreshState("Enter the Marketly API base first.");
    return;
  }
  if (!pairingCode) {
    await refreshState("Paste the one-time pairing code from Marketly first.");
    return;
  }

  let originPattern;
  try {
    originPattern = toOriginPattern(apiBase);
  } catch {
    await refreshState("API base is not a valid URL.");
    return;
  }

  const granted = await permissionsRequest({ origins: [originPattern] });
  if (!granted) {
    await refreshState("The helper needs permission for that Marketly API origin before it can pair.");
    return;
  }

  let response;
  try {
    response = await fetch(`${apiBase}/connectors/facebook/helper/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairing_code: pairingCode })
    });
  } catch (error) {
    await refreshState(error instanceof Error ? error.message : "Pairing failed.");
    return;
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload || !payload.helper_token) {
    const message = payload && typeof payload.detail === "string"
      ? payload.detail
      : text || "Pairing failed.";
    await refreshState(message);
    return;
  }

  await storageSet({
    [STORAGE_KEYS.apiBase]: apiBase,
    [STORAGE_KEYS.helperToken]: payload.helper_token,
    [STORAGE_KEYS.helperLabel]: payload.helper_label || "Browser Helper",
    [STORAGE_KEYS.lastError]: "",
    [STORAGE_KEYS.lastSyncSummary]: "Paired successfully. Syncing now..."
  });
  pairingCodeInput.value = "";
  const syncResult = await runtimeSendMessage({ type: "sync-now" });
  await refreshState(syncResult && syncResult.message ? syncResult.message : "Paired successfully.");
}

async function syncNow() {
  const result = await runtimeSendMessage({ type: "sync-now" });
  await refreshState(result && result.message ? result.message : "Sync request sent.");
}

async function forgetLocalToken() {
  await storageRemove([
    STORAGE_KEYS.helperToken,
    STORAGE_KEYS.helperLabel,
    STORAGE_KEYS.lastFingerprint,
    STORAGE_KEYS.lastSyncAt,
    STORAGE_KEYS.lastError,
    STORAGE_KEYS.lastAttemptAt,
    STORAGE_KEYS.lastSyncSummary
  ]);
  await refreshState("Removed the local helper token. Pair again from Marketly when you are ready.");
}

pairButton.addEventListener("click", () => void pairHelper());
syncButton.addEventListener("click", () => void syncNow());
forgetButton.addEventListener("click", () => void forgetLocalToken());
chrome.storage.onChanged.addListener(() => {
  void refreshState();
});

void refreshState();
