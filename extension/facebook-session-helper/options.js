const STORAGE_KEYS = {
  apiBase: "apiBase",
  developerMode: "developerMode",
  devApiBase: "devApiBase",
  pairedApiTarget: "pairedApiTarget",
  helperToken: "helperToken",
  helperLabel: "helperLabel",
  marketlyAppBase: "marketlyAppBase",
  lastFingerprint: "lastFingerprint",
  lastSyncAt: "lastSyncAt",
  lastError: "lastError",
  lastAttemptAt: "lastAttemptAt",
  lastSyncSummary: "lastSyncSummary",
  lastFailureReason: "lastFailureReason",
  lastStatus: "lastStatus",
  nextRetryAt: "nextRetryAt",
  retryAttempt: "retryAttempt",
  lastAttentionPromptAt: "lastAttentionPromptAt",
  lastAttentionReason: "lastAttentionReason",
  privacyConsentAccepted: "privacyConsentAccepted"
};

const {
  DEFAULT_DEVELOPER_API_BASE,
  buildStatusLines,
  getApiTargetId,
  normalizeApiBase,
  parseOptionsPrefill,
  resolveApiBase,
  resolveApiMode,
  toOriginPattern,
  validateDeveloperApiBase
} = window.MarketlyHelperUtils;

const pairingCodeInput = document.getElementById("pairing-code");
const pairButton = document.getElementById("pair-helper");
const syncButton = document.getElementById("sync-now");
const forgetButton = document.getElementById("forget-helper");
const statusNode = document.getElementById("status");
const developerModeInput = document.getElementById("developer-mode");
const developerFields = document.getElementById("developer-fields");
const devApiBaseInput = document.getElementById("dev-api-base");
const devApiBaseHelpNode = document.getElementById("dev-api-base-help");
const privacyConsentPromptNode = document.getElementById("privacy-consent-prompt");
const privacyConsentSavedNode = document.getElementById("privacy-consent-saved");
const privacyConsentInput = document.getElementById("privacy-consent");

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(payload) {
  return new Promise((resolve) => chrome.storage.local.set(payload, resolve));
}

function storageRemove(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
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

function hasPrivacyConsent(state) {
  return state && state.privacyConsentAccepted === true;
}

function stateWithCurrentDeveloperControls(state = {}) {
  return {
    ...state,
    developerMode: developerModeInput.checked,
    devApiBase: normalizeApiBase(devApiBaseInput.value || DEFAULT_DEVELOPER_API_BASE)
  };
}

function renderState(state, extraMessage = "") {
  const effectiveDeveloperMode = resolveApiMode(state) === "developer";
  const consentAccepted = hasPrivacyConsent(state);
  developerModeInput.checked = effectiveDeveloperMode;
  privacyConsentInput.checked = consentAccepted;
  privacyConsentPromptNode.hidden = consentAccepted;
  privacyConsentSavedNode.hidden = !consentAccepted;
  devApiBaseInput.value = normalizeApiBase(state.devApiBase || state.apiBase || DEFAULT_DEVELOPER_API_BASE);
  developerFields.hidden = !effectiveDeveloperMode;

  const lines = buildStatusLines(stateWithCurrentDeveloperControls(state), extraMessage);
  statusNode.textContent = lines.join("\n");
  updateDeveloperApiBaseHelp();
}

async function refreshState(extraMessage = "") {
  const state = await readState();
  renderState(state, extraMessage);
}

async function pairHelper() {
  const currentState = await readState();
  if (!hasPrivacyConsent(currentState)) {
    await refreshState("Accept the privacy disclosure before pairing.");
    return;
  }
  const targetState = stateWithCurrentDeveloperControls(currentState);
  let apiBase = normalizeApiBase(resolveApiBase(targetState));
  let targetId = getApiTargetId(targetState);
  const pairingCode = String(pairingCodeInput.value || "").trim();
  if (!pairingCode) {
    await refreshState("Paste the one-time pairing code from Marketly first.");
    return;
  }

  if (resolveApiMode(targetState) === "developer") {
    const developerApiBase = normalizeApiBase(targetState.devApiBase || DEFAULT_DEVELOPER_API_BASE);
    const validation = validateDeveloperApiBase(developerApiBase);
    if (!validation.ok) {
      await refreshState(validation.message);
      return;
    }
    apiBase = developerApiBase;
    targetId = getApiTargetId({ ...targetState, devApiBase: apiBase });

    let originPattern;
    try {
      originPattern = toOriginPattern(apiBase);
    } catch {
      await refreshState("Developer API base is not a valid URL.");
      return;
    }

    const granted = await permissionsRequest({ origins: [originPattern] });
    if (!granted) {
      await refreshState(
        "Local API permission was not granted. Allow the developer API origin, then retry."
      );
      return;
    }
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
    [STORAGE_KEYS.developerMode]: resolveApiMode(targetState) === "developer",
    [STORAGE_KEYS.devApiBase]: resolveApiMode(targetState) === "developer" ? apiBase : DEFAULT_DEVELOPER_API_BASE,
    [STORAGE_KEYS.pairedApiTarget]: targetId,
    [STORAGE_KEYS.helperToken]: payload.helper_token,
    [STORAGE_KEYS.helperLabel]: payload.helper_label || "Browser Helper",
    [STORAGE_KEYS.lastError]: "",
    [STORAGE_KEYS.lastFailureReason]: "",
    [STORAGE_KEYS.lastStatus]: "paired",
    [STORAGE_KEYS.nextRetryAt]: "",
    [STORAGE_KEYS.retryAttempt]: 0,
    [STORAGE_KEYS.lastSyncSummary]: "Paired successfully. Syncing now...",
    [STORAGE_KEYS.privacyConsentAccepted]: true
  });
  await storageRemove([STORAGE_KEYS.apiBase]);
  pairingCodeInput.value = "";
  const isDeveloper = resolveApiMode(targetState) === "developer";
  const syncResult = await runtimeSendMessage({
    type: "sync-now",
    config: {
      helperToken: payload.helper_token,
      developerMode: isDeveloper,
      devApiBase: isDeveloper ? apiBase : DEFAULT_DEVELOPER_API_BASE,
      pairedApiTarget: targetId
    }
  });
  await refreshState(syncResult && syncResult.message ? syncResult.message : "Paired successfully.");
}

async function syncNow() {
  const state = await readState();
  if (!hasPrivacyConsent(state)) {
    await refreshState("Accept the privacy disclosure before syncing.");
    return;
  }
  const result = await runtimeSendMessage({
    type: "sync-now",
    config: {
      helperToken: state.helperToken,
      developerMode: state.developerMode,
      devApiBase: state.devApiBase,
      pairedApiTarget: state.pairedApiTarget
    }
  });
  await refreshState(result && result.message ? result.message : "Sync request sent.");
}

async function forgetLocalToken() {
  await storageRemove([
    STORAGE_KEYS.helperToken,
    STORAGE_KEYS.helperLabel,
    STORAGE_KEYS.pairedApiTarget,
    STORAGE_KEYS.lastAttentionPromptAt,
    STORAGE_KEYS.lastAttentionReason,
    STORAGE_KEYS.lastFingerprint,
    STORAGE_KEYS.lastSyncAt,
    STORAGE_KEYS.lastError,
    STORAGE_KEYS.lastAttemptAt,
    STORAGE_KEYS.lastSyncSummary,
    STORAGE_KEYS.lastFailureReason,
    STORAGE_KEYS.lastStatus,
    STORAGE_KEYS.nextRetryAt,
    STORAGE_KEYS.retryAttempt
  ]);
  await refreshState("Removed the local helper token. Pair again from Marketly when you are ready.");
}

async function persistPrivacyConsent() {
  await storageSet({ [STORAGE_KEYS.privacyConsentAccepted]: privacyConsentInput.checked === true });
  await refreshState();
}

async function persistDeveloperSettings() {
  const developerMode = developerModeInput.checked;
  const devApiBase = normalizeApiBase(devApiBaseInput.value || DEFAULT_DEVELOPER_API_BASE);
  developerFields.hidden = !developerMode;
  await storageSet({
    [STORAGE_KEYS.developerMode]: developerMode,
    [STORAGE_KEYS.devApiBase]: devApiBase
  });
  await storageRemove([STORAGE_KEYS.apiBase]);
  await refreshState();
}

function updateDeveloperApiBaseHelp() {
  const validation = validateDeveloperApiBase(devApiBaseInput.value || DEFAULT_DEVELOPER_API_BASE);
  const message = validation.warning || validation.message || "";
  devApiBaseHelpNode.textContent = message || "Example: http://127.0.0.1:8000";
  devApiBaseHelpNode.className = validation.warning ? "warning" : "muted help";
}

async function applyQueryPrefill() {
  const prefill = parseOptionsPrefill(window.location.search);
  const updates = {};
  let message = "";
  if (prefill.apiBase) {
    const validation = validateDeveloperApiBase(prefill.apiBase);
    if (validation.ok) {
      developerModeInput.checked = true;
      developerFields.hidden = false;
      devApiBaseInput.value = prefill.apiBase;
      updates[STORAGE_KEYS.developerMode] = true;
      updates[STORAGE_KEYS.devApiBase] = prefill.apiBase;
      message = "Developer API base prefilled.";
    }
  }
  if (prefill.pairingCode) {
    pairingCodeInput.value = prefill.pairingCode;
    message = message ? `${message} Pairing code prefilled.` : "Pairing code prefilled from Marketly.";
  }
  if (Object.keys(updates).length > 0) {
    await storageSet(updates);
    await storageRemove([STORAGE_KEYS.apiBase]);
  }
  if (message) {
    await refreshState(message);
    pairingCodeInput.value = prefill.pairingCode;
  }
}

pairButton.addEventListener("click", () => void pairHelper());
syncButton.addEventListener("click", () => void syncNow());
forgetButton.addEventListener("click", () => void forgetLocalToken());
developerModeInput.addEventListener("change", () => void persistDeveloperSettings());
devApiBaseInput.addEventListener("input", updateDeveloperApiBaseHelp);
devApiBaseInput.addEventListener("change", () => void persistDeveloperSettings());
privacyConsentInput.addEventListener("change", () => void persistPrivacyConsent());
chrome.storage.onChanged.addListener(() => {
  void refreshState();
});

void refreshState().then(() => applyQueryPrefill());
