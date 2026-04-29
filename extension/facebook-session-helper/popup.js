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

const MARKETLY_APP_PATH = "/facebook-configuration";

const {
  DEFAULT_DEVELOPER_API_BASE,
  buildMarketlyAppUrl,
  getApiTargetId,
  getPairedApiTargetId,
  normalizeApiBase,
  parseOptionsPrefill,
  resolveApiBase,
  resolveApiMode,
  toOriginPattern,
  validateDeveloperApiBase
} = window.MarketlyHelperUtils;

const $ = (id) => document.getElementById(id);

const els = {
  pill: $("status-pill"),
  consentGate: $("consent-gate"),
  consentAccept: $("privacy-consent-accept"),
  consentOpenMarketly: $("privacy-consent-open-marketly"),
  consentMsg: $("consent-msg"),
  helperMain: $("helper-main"),
  pairedView: $("paired-view"),
  unpairedView: $("unpaired-view"),
  pairedLabel: $("paired-label"),
  repairToggle: $("repair-toggle"),
  cancelRepair: $("cancel-repair"),
  pairingCode: $("pairing-code"),
  pairBtn: $("pair-helper"),
  pairMsg: $("pair-msg"),
  syncBtn: $("sync-now"),
  openMarketly: $("open-marketly"),
  lastSyncText: $("last-sync-text"),
  syncMsg: $("sync-msg"),
  dtApiMode: $("dt-api-mode"),
  dtPairing: $("dt-pairing"),
  dtLastAttempt: $("dt-last-attempt"),
  dtNextRetry: $("dt-next-retry"),
  dtLastError: $("dt-last-error"),
  devToggle: $("developer-mode"),
  devFields: $("developer-fields"),
  devApiBase: $("dev-api-base"),
  devApiBaseHelp: $("dev-api-base-help"),
  forgetDefault: $("forget-default"),
  forgetConfirm: $("forget-confirm"),
  forgetBtn: $("forget-helper"),
  forgetCancelBtn: $("forget-cancel"),
  forgetConfirmBtn: $("forget-confirm-btn"),
  openOptions: $("open-options")
};

let busy = false;
let repairMode = false;
let lastRenderedState = {};

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

function readState() {
  return storageGet(Object.values(STORAGE_KEYS));
}

function hasPrivacyConsent(state) {
  return state && state.privacyConsentAccepted === true;
}

function setBusy(value) {
  busy = !!value;
  const buttons = [
    els.consentAccept,
    els.pairBtn,
    els.syncBtn,
    els.forgetBtn,
    els.forgetConfirmBtn,
    els.repairToggle
  ];
  for (const btn of buttons) {
    if (btn) btn.disabled = busy;
  }
}

function setPill(tone, text) {
  els.pill.dataset.tone = tone;
  els.pill.querySelector(".text").textContent = text;
}

function setMessage(node, tone, text) {
  if (!node) return;
  node.dataset.tone = tone || "muted";
  node.textContent = text || "";
}

function formatRelative(value) {
  if (!value) return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  const diff = Date.now() - ts;
  if (diff < 0) {
    const future = Math.abs(diff);
    if (future < 60_000) return "in a few seconds";
    if (future < 3_600_000) return `in ${Math.round(future / 60_000)} min`;
    return `at ${new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
  return new Date(ts).toLocaleDateString();
}

function describePillFromState(state) {
  const helperToken = String(state.helperToken || "").trim();
  if (!helperToken) return { tone: "muted", text: "Not connected" };
  const pairedTarget = getPairedApiTargetId(state);
  const activeTarget = getApiTargetId(state);
  if (pairedTarget && pairedTarget !== activeTarget) {
    return { tone: "warn", text: "Re-pair needed" };
  }
  const reason = String(state.lastFailureReason || "").trim();
  const lastError = String(state.lastError || "").trim();
  if (reason === "token_invalid") return { tone: "error", text: "Token invalid" };
  if (reason === "no_facebook_cookies") return { tone: "warn", text: "Open Facebook" };
  if (reason === "consent_required") return { tone: "warn", text: "Consent required" };
  if (reason === "api_unreachable") return { tone: "warn", text: "API unreachable" };
  if (lastError) return { tone: "error", text: "Error" };
  if (state.nextRetryAt) return { tone: "warn", text: "Retrying soon" };
  return { tone: "ok", text: "Connected" };
}

function describePairing(state) {
  const helperToken = String(state.helperToken || "").trim();
  if (!helperToken) return "Not paired";
  const pairedTarget = getPairedApiTargetId(state);
  const activeTarget = getApiTargetId(state);
  if (pairedTarget && pairedTarget !== activeTarget) {
    return `Paired with ${pairedTarget.startsWith("developer:") ? "developer" : "production"} (mismatch)`;
  }
  return state.helperLabel ? `Paired as ${state.helperLabel}` : "Paired";
}

function describeLastSync(state) {
  if (!state.helperToken) return "Pair the helper to start syncing";
  const summary = String(state.lastSyncSummary || "").trim();
  const when = formatRelative(state.lastSyncAt);
  if (state.lastSyncAt && summary) return `${when || "Recently"} · ${summary}`;
  if (state.lastSyncAt) return `Last sync ${when}`;
  if (summary) return summary;
  return "No sync yet";
}

function renderState(state) {
  lastRenderedState = state || {};
  const helperToken = String(state.helperToken || "").trim();
  const paired = Boolean(helperToken);
  const consentAccepted = hasPrivacyConsent(state);
  els.consentGate.classList.toggle("hidden", consentAccepted);
  els.helperMain.classList.toggle("hidden", !consentAccepted);
  setMessage(
    els.consentMsg,
    "muted",
    consentAccepted ? "" : "Allow cookie sync once to finish setting up the helper on this browser."
  );

  // Header pill (don't override "Syncing" while busy)
  if (!busy) {
    const pill = consentAccepted ? describePillFromState(state) : { tone: "warn", text: "Consent" };
    setPill(pill.tone, pill.text);
  }

  // Pairing section
  if (paired && !repairMode) {
    els.pairedView.classList.remove("hidden");
    els.unpairedView.classList.add("hidden");
    els.pairedLabel.textContent = state.helperLabel || "Browser Helper";
  } else {
    els.pairedView.classList.add("hidden");
    els.unpairedView.classList.remove("hidden");
    els.cancelRepair.classList.toggle("hidden", !repairMode);
    if (!repairMode && !els.pairingCode.value) {
      setMessage(els.pairMsg, "muted", "Generate a code in Marketly's Facebook configuration.");
    }
  }

  // Sync section
  els.syncBtn.disabled = busy || !paired || !consentAccepted;
  els.lastSyncText.textContent = describeLastSync(state);

  // Status details
  const mode = resolveApiMode(state);
  els.dtApiMode.textContent = mode === "developer"
    ? `Developer (${resolveApiBase(state)})`
    : "Production";
  els.dtPairing.textContent = describePairing(state);
  els.dtLastAttempt.textContent = state.lastAttemptAt
    ? `${formatRelative(state.lastAttemptAt)} (${new Date(state.lastAttemptAt).toLocaleTimeString()})`
    : "Never";
  els.dtNextRetry.textContent = state.nextRetryAt
    ? `${formatRelative(state.nextRetryAt)} (${new Date(state.nextRetryAt).toLocaleTimeString()})`
    : "None";
  const errText = String(state.lastError || "").trim();
  els.dtLastError.textContent = errText || "None";
  els.dtLastError.classList.toggle("error", !!errText);

  // Developer mode
  const devMode = mode === "developer";
  els.devToggle.checked = devMode;
  els.devApiBase.value = normalizeApiBase(state.devApiBase || state.apiBase || DEFAULT_DEVELOPER_API_BASE);
  els.devFields.classList.toggle("hidden", !devMode);
  updateDevApiBaseHelp();
}

async function refresh() {
  const state = await readState();
  renderState(state);
}

function updateDevApiBaseHelp() {
  const validation = validateDeveloperApiBase(els.devApiBase.value || DEFAULT_DEVELOPER_API_BASE);
  if (!validation.ok) {
    els.devApiBase.setAttribute("aria-invalid", "true");
    els.devApiBase.removeAttribute("data-valid");
    els.devApiBaseHelp.dataset.tone = "error";
    els.devApiBaseHelp.textContent = validation.message;
    return;
  }
  els.devApiBase.removeAttribute("aria-invalid");
  els.devApiBase.dataset.valid = "true";
  if (validation.warning) {
    els.devApiBaseHelp.dataset.tone = "warn";
    els.devApiBaseHelp.textContent = validation.warning;
  } else {
    els.devApiBaseHelp.dataset.tone = "ok";
    els.devApiBaseHelp.textContent = "Looks good. Local backend reachable at this URL.";
  }
}

async function persistDeveloperSettings() {
  const developerMode = els.devToggle.checked;
  const devApiBase = normalizeApiBase(els.devApiBase.value || DEFAULT_DEVELOPER_API_BASE);
  els.devFields.classList.toggle("hidden", !developerMode);
  await storageSet({
    [STORAGE_KEYS.developerMode]: developerMode,
    [STORAGE_KEYS.devApiBase]: devApiBase
  });
  await storageRemove([STORAGE_KEYS.apiBase]);
  await refresh();
}

function stateWithCurrentDeveloperControls(state) {
  return {
    ...state,
    developerMode: els.devToggle.checked,
    devApiBase: normalizeApiBase(els.devApiBase.value || DEFAULT_DEVELOPER_API_BASE)
  };
}

async function pairHelper() {
  if (busy) return;
  const currentState = await readState();
  if (!hasPrivacyConsent(currentState)) {
    setMessage(els.pairMsg, "warn", "Accept the privacy disclosure before pairing.");
    return;
  }
  const pairingCode = String(els.pairingCode.value || "").trim();
  if (!pairingCode) {
    setMessage(els.pairMsg, "warn", "Paste the one-time code from Marketly first.");
    return;
  }

  const targetState = stateWithCurrentDeveloperControls(currentState);
  let apiBase = normalizeApiBase(resolveApiBase(targetState));
  let targetId = getApiTargetId(targetState);
  const isDeveloper = resolveApiMode(targetState) === "developer";

  if (isDeveloper) {
    const developerApiBase = normalizeApiBase(targetState.devApiBase || DEFAULT_DEVELOPER_API_BASE);
    const validation = validateDeveloperApiBase(developerApiBase);
    if (!validation.ok) {
      setMessage(els.pairMsg, "error", validation.message);
      return;
    }
    apiBase = developerApiBase;
    targetId = getApiTargetId({ ...targetState, devApiBase: apiBase });

    let originPattern;
    try {
      originPattern = toOriginPattern(apiBase);
    } catch {
      setMessage(els.pairMsg, "error", "Developer API base is not a valid URL.");
      return;
    }

    const granted = await permissionsRequest({ origins: [originPattern] });
    if (!granted) {
      setMessage(els.pairMsg, "error", "Local API permission was not granted. Allow the origin and retry.");
      return;
    }
  }

  setBusy(true);
  setPill("busy", "Pairing");
  setMessage(els.pairMsg, "muted", "Pairing helper…");

  let response;
  try {
    response = await fetch(`${apiBase}/connectors/facebook/helper/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairing_code: pairingCode })
    });
  } catch (error) {
    setBusy(false);
    const msg = error instanceof Error ? error.message : "Pairing request failed.";
    setMessage(els.pairMsg, "error", msg.includes("Failed to fetch") ? "Could not reach Marketly. Check your network." : msg);
    await refresh();
    return;
  }

  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }

  if (!response.ok || !payload || !payload.helper_token) {
    setBusy(false);
    const detail = payload && typeof payload.detail === "string"
      ? payload.detail
      : (text || "Pairing failed. Generate a fresh code in Marketly.");
    setMessage(els.pairMsg, "error", detail);
    await refresh();
    return;
  }

  await storageSet({
    [STORAGE_KEYS.developerMode]: isDeveloper,
    [STORAGE_KEYS.devApiBase]: isDeveloper ? apiBase : DEFAULT_DEVELOPER_API_BASE,
    [STORAGE_KEYS.pairedApiTarget]: targetId,
    [STORAGE_KEYS.helperToken]: payload.helper_token,
    [STORAGE_KEYS.helperLabel]: payload.helper_label || "Browser Helper",
    [STORAGE_KEYS.lastError]: "",
    [STORAGE_KEYS.lastFailureReason]: "",
    [STORAGE_KEYS.lastStatus]: "paired",
    [STORAGE_KEYS.nextRetryAt]: "",
    [STORAGE_KEYS.retryAttempt]: 0,
    [STORAGE_KEYS.lastSyncSummary]: "Paired successfully. Syncing now…",
    [STORAGE_KEYS.privacyConsentAccepted]: true
  });
  await storageRemove([STORAGE_KEYS.apiBase]);
  els.pairingCode.value = "";
  repairMode = false;

  setPill("busy", "Syncing");
  setMessage(els.syncMsg, "muted", "Syncing cookies after pairing…");

  const syncResult = await runtimeSendMessage({
    type: "sync-now",
    config: {
      helperToken: payload.helper_token,
      developerMode: isDeveloper,
      devApiBase: isDeveloper ? apiBase : DEFAULT_DEVELOPER_API_BASE,
      pairedApiTarget: targetId
    }
  });

  setBusy(false);
  if (syncResult && syncResult.ok) {
    setMessage(els.syncMsg, "ok", syncResult.message || "Paired and synced.");
  } else if (syncResult && syncResult.message) {
    setMessage(els.syncMsg, syncResult.skipped ? "warn" : "error", syncResult.message);
  } else {
    setMessage(els.syncMsg, "ok", "Paired successfully.");
  }
  await refresh();
}

async function syncNow() {
  if (busy) return;
  const state = await readState();
  if (!hasPrivacyConsent(state)) {
    setMessage(els.syncMsg, "warn", "Accept the privacy disclosure before syncing.");
    return;
  }
  if (!state.helperToken) {
    setMessage(els.syncMsg, "warn", "Pair the helper before syncing.");
    return;
  }
  setBusy(true);
  setPill("busy", "Syncing");
  setMessage(els.syncMsg, "muted", "Syncing facebook.com cookies…");

  const result = await runtimeSendMessage({
    type: "sync-now",
    config: {
      helperToken: state.helperToken,
      developerMode: state.developerMode,
      devApiBase: state.devApiBase,
      pairedApiTarget: state.pairedApiTarget
    }
  });

  setBusy(false);
  if (result && result.ok) {
    setMessage(els.syncMsg, "ok", result.message || "Synced.");
  } else if (result && result.message) {
    const tone = result.status === "no_facebook_cookies" || result.skipped ? "warn" : "error";
    setMessage(els.syncMsg, tone, result.message);
  } else {
    setMessage(els.syncMsg, "error", "Sync failed. Try again.");
  }
  await refresh();
}

async function forgetLocalToken() {
  if (busy) return;
  setBusy(true);
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
  setBusy(false);
  hideForgetConfirm();
  setMessage(els.pairMsg, "muted", "Local token removed. Pair again from Marketly when you're ready.");
  await refresh();
}

async function acceptPrivacyConsent() {
  if (busy) return;
  setBusy(true);
  await storageSet({ [STORAGE_KEYS.privacyConsentAccepted]: true });
  setBusy(false);
  await refresh();
  setMessage(els.pairMsg, "ok", "Consent saved. Pair the helper to continue.");
}

function showForgetConfirm() {
  els.forgetDefault.classList.add("hidden");
  els.forgetConfirm.classList.remove("hidden");
}
function hideForgetConfirm() {
  els.forgetDefault.classList.remove("hidden");
  els.forgetConfirm.classList.add("hidden");
}

function openMarketly() {
  const url = buildMarketlyAppUrl(lastRenderedState, MARKETLY_APP_PATH);
  if (chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, "_blank", "noopener");
  }
}

async function applyQueryPrefill() {
  const prefill = parseOptionsPrefill(window.location.search);
  if (!prefill.apiBase && !prefill.pairingCode) return;
  const updates = {};
  if (prefill.apiBase) {
    const validation = validateDeveloperApiBase(prefill.apiBase);
    if (validation.ok) {
      els.devToggle.checked = true;
      els.devApiBase.value = prefill.apiBase;
      els.devFields.classList.remove("hidden");
      updates[STORAGE_KEYS.developerMode] = true;
      updates[STORAGE_KEYS.devApiBase] = prefill.apiBase;
    }
  }
  if (prefill.pairingCode) {
    els.pairingCode.value = prefill.pairingCode;
    repairMode = true;
    els.pairedView.classList.add("hidden");
    els.unpairedView.classList.remove("hidden");
    els.cancelRepair.classList.remove("hidden");
    setMessage(els.pairMsg, "muted", "Pairing code prefilled from Marketly.");
  }
  if (Object.keys(updates).length > 0) {
    await storageSet(updates);
    await storageRemove([STORAGE_KEYS.apiBase]);
    await refresh();
  }
}

// Wire events
els.pairBtn.addEventListener("click", () => void pairHelper());
els.syncBtn.addEventListener("click", () => void syncNow());
els.openMarketly.addEventListener("click", openMarketly);
els.consentOpenMarketly.addEventListener("click", openMarketly);
els.consentAccept.addEventListener("click", () => void acceptPrivacyConsent());
els.repairToggle.addEventListener("click", () => {
  repairMode = true;
  renderState(lastRenderedState);
  els.pairingCode.focus();
});
els.cancelRepair.addEventListener("click", () => {
  repairMode = false;
  els.pairingCode.value = "";
  setMessage(els.pairMsg, "muted", "");
  renderState(lastRenderedState);
});
els.pairingCode.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void pairHelper();
});
els.devToggle.addEventListener("change", () => void persistDeveloperSettings());
els.devApiBase.addEventListener("input", updateDevApiBaseHelp);
els.devApiBase.addEventListener("change", () => void persistDeveloperSettings());
els.forgetBtn.addEventListener("click", showForgetConfirm);
els.forgetCancelBtn.addEventListener("click", hideForgetConfirm);
els.forgetConfirmBtn.addEventListener("click", () => void forgetLocalToken());
els.openOptions.addEventListener("click", () => {
  if (chrome.runtime && chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  }
});

chrome.storage.onChanged.addListener(() => {
  if (!busy) void refresh();
});

void refresh().then(() => applyQueryPrefill());
