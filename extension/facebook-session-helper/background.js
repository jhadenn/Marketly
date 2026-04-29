importScripts("utils.js");

const ALARM_NAME = "marketly-facebook-sync";
const RETRY_ALARM_NAME = "marketly-facebook-sync-retry";
const ALARM_INTERVAL_MINUTES = 15;
const HEARTBEAT_WINDOW_MS = 30 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 5;
const ATTENTION_NOTIFICATION_ID = "marketly-facebook-helper-attention";
const FACEBOOK_MARKETPLACE_URL = "https://www.facebook.com/marketplace/";

const {
  DEFAULT_DEVELOPER_API_BASE,
  classifyError,
  computeBackoffDelayMs,
  getApiTargetId,
  getHelperAttentionDescriptor,
  getPairedApiTargetId,
  normalizeApiBase,
  resolveApiBase,
  resolveApiMode,
  shouldPromptForAttention,
  toOriginPattern,
  validateDeveloperApiBase
} = self.MarketlyHelperUtils;

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

const FACEBOOK_COOKIE_ALLOWLIST = new Set([
  "c_user",
  "xs",
  "fr",
  "datr",
  "sb"
]);

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(payload) {
  return new Promise((resolve) => chrome.storage.local.set(payload, resolve));
}

function permissionsContains(permissions) {
  return new Promise((resolve) => {
    if (!chrome.permissions || !chrome.permissions.contains) {
      resolve(false);
      return;
    }
    chrome.permissions.contains(permissions, resolve);
  });
}

function permissionsRequest(permissions) {
  return new Promise((resolve) => {
    if (!chrome.permissions || !chrome.permissions.request) {
      resolve(false);
      return;
    }
    chrome.permissions.request(permissions, resolve);
  });
}

function tabsCreate(payload) {
  return new Promise((resolve) => {
    if (!chrome.tabs || !chrome.tabs.create) {
      resolve(null);
      return;
    }
    chrome.tabs.create(payload, resolve);
  });
}

function notificationsCreate(id, options) {
  return new Promise((resolve) => {
    if (!chrome.notifications || !chrome.notifications.create) {
      resolve("");
      return;
    }
    chrome.notifications.create(id, options, resolve);
  });
}

function notificationsClear(id) {
  return new Promise((resolve) => {
    if (!chrome.notifications || !chrome.notifications.clear) {
      resolve(false);
      return;
    }
    chrome.notifications.clear(id, resolve);
  });
}

function createAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_INTERVAL_MINUTES });
}

async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function cookiesGetAll(details) {
  return new Promise((resolve) => chrome.cookies.getAll(details, resolve));
}

async function collectFacebookCookies() {
  const cookies = await cookiesGetAll({ domain: "facebook.com" });
  return cookies
    .filter((cookie) =>
      (cookie.domain || "").includes("facebook.com")
      && FACEBOOK_COOKIE_ALLOWLIST.has(String(cookie.name || ""))
    )
    .map((cookie) => {
      const payload = {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly
      };
      if (typeof cookie.expirationDate === "number") {
        payload.expirationDate = cookie.expirationDate;
      }
      if (cookie.sameSite) {
        payload.sameSite = cookie.sameSite;
      }
      if (cookie.storeId) {
        payload.storeId = cookie.storeId;
      }
      return payload;
    });
}

async function uploadCookies({ apiBase, helperToken, cookies }) {
  const response = await fetch(`${normalizeApiBase(apiBase)}/connectors/facebook/helper/cookies`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${helperToken}`
    },
    body: JSON.stringify({ cookies_json: cookies })
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = payload && typeof payload.detail === "string"
      ? payload.detail
      : payload && payload.detail && typeof payload.detail.error_message === "string"
        ? payload.detail.error_message
        : text || "Cookie sync failed.";
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function sendHeartbeat({ apiBase, helperToken }) {
  const response = await fetch(`${normalizeApiBase(apiBase)}/connectors/facebook/helper/heartbeat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${helperToken}`
    }
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const detail = payload && typeof payload.detail === "string"
      ? payload.detail
      : text || "Heartbeat failed.";
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function getHelperConfig() {
  return storageGet(Object.values(STORAGE_KEYS));
}

function mergeConfigOverride(stored, override) {
  if (!override || typeof override !== "object") {
    return stored;
  }
  const merged = { ...stored };
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined && value !== null && value !== "") {
      merged[key] = value;
    }
  }
  return merged;
}

function stateWithSyncResult(state, result) {
  if (!result || result.ok) {
    return state;
  }
  return {
    ...state,
    lastFailureReason: result.status || state.lastFailureReason,
    lastError: result.message || state.lastError
  };
}

async function setActionIndicator(state) {
  if (!chrome.action) {
    return;
  }
  const descriptor = getHelperAttentionDescriptor(state);
  try {
    await chrome.action.setBadgeText({ text: descriptor ? descriptor.badgeText : "" });
    if (descriptor) {
      await chrome.action.setBadgeBackgroundColor({ color: descriptor.badgeColor });
      await chrome.action.setTitle({ title: descriptor.title });
    } else {
      await chrome.action.setTitle({ title: "Marketly Helper" });
    }
  } catch (error) {
    console.warn("[marketly-helper] failed to update action indicator", error);
  }
}

async function openHelperSurface() {
  try {
    if (chrome.action && chrome.action.openPopup) {
      await chrome.action.openPopup();
      return true;
    }
  } catch (error) {
    console.info("[marketly-helper] openPopup unavailable", error);
  }

  if (chrome.runtime && chrome.runtime.getURL) {
    await tabsCreate({ url: chrome.runtime.getURL("popup.html") });
    return true;
  }
  return false;
}

async function openFacebookMarketplace() {
  await tabsCreate({ url: FACEBOOK_MARKETPLACE_URL });
}

async function showAttentionNotification(descriptor) {
  if (!descriptor) {
    return false;
  }
  const notificationId = await notificationsCreate(ATTENTION_NOTIFICATION_ID, {
    type: "basic",
    iconUrl: "icon-128.png",
    title: descriptor.title,
    message: descriptor.message,
    priority: 1,
    buttons: [
      { title: "Open helper" },
      { title: "Open Facebook" }
    ]
  });
  return Boolean(notificationId);
}

async function maybePromptForAttention(state, result, { allowPrompt = true } = {}) {
  const effectiveState = stateWithSyncResult(state, result);
  const descriptor = getHelperAttentionDescriptor(effectiveState);
  await setActionIndicator(effectiveState);
  if (!allowPrompt || !shouldPromptForAttention(effectiveState, descriptor, Date.now())) {
    return;
  }

  const opened = await openHelperSurface();
  if (!opened) {
    await showAttentionNotification(descriptor);
  }
  await storageSet({
    [STORAGE_KEYS.lastAttentionPromptAt]: new Date().toISOString(),
    [STORAGE_KEYS.lastAttentionReason]: descriptor.reason
  });
}

async function finalizeSyncResult(result, { allowPrompt = true } = {}) {
  const state = await getHelperConfig();
  const effectiveState = stateWithSyncResult(state, result);
  if (result && result.ok) {
    await notificationsClear(ATTENTION_NOTIFICATION_ID);
    await setActionIndicator(effectiveState);
    return result;
  }
  await maybePromptForAttention(effectiveState, result, { allowPrompt });
  return result;
}

async function syncCookies({ force = false, reason = "manual", configOverride = null } = {}) {
  const stored = await getHelperConfig();
  const config = mergeConfigOverride(stored, configOverride);
  const apiBase = normalizeApiBase(resolveApiBase(config));
  const activeApiTarget = getApiTargetId(config);
  const pairedApiTarget = getPairedApiTargetId(config);
  const helperToken = String(config.helperToken || "").trim();
  const nowIso = new Date().toISOString();
  const allowPrompt = reason !== "options-sync";
  const consentAccepted = config.privacyConsentAccepted === true;

  console.log("[marketly-helper] syncCookies", {
    reason,
    apiBase,
    activeApiTarget,
    pairedApiTarget,
    storedHelperTokenPresent: Boolean(stored.helperToken),
    overrideHelperTokenPresent: Boolean(configOverride && configOverride.helperToken),
    helperTokenPresent: Boolean(helperToken)
  });

  if (!apiBase || !helperToken) {
    return finalizeSyncResult({
      ok: false,
      skipped: true,
      message: "Pair the helper before syncing.",
      status: "not_paired"
    }, { allowPrompt });
  }

  if (!consentAccepted) {
    await storageSet({
      [STORAGE_KEYS.lastError]: "Privacy consent is required before syncing cookies.",
      [STORAGE_KEYS.lastFailureReason]: "consent_required",
      [STORAGE_KEYS.lastStatus]: "consent_required",
      [STORAGE_KEYS.nextRetryAt]: "",
      [STORAGE_KEYS.retryAttempt]: 0
    });
    return finalizeSyncResult({
      ok: false,
      skipped: true,
      message: "Review and accept the privacy disclosure in the helper before syncing.",
      status: "consent_required"
    }, { allowPrompt });
  }

  if (pairedApiTarget && pairedApiTarget !== activeApiTarget) {
    return finalizeSyncResult({
      ok: false,
      skipped: true,
      message: "This helper token was paired with another API mode. Delete the local token, then pair again.",
      status: "target_mismatch"
    }, { allowPrompt });
  }

  await storageSet({ [STORAGE_KEYS.lastAttemptAt]: nowIso });

  const cookies = await collectFacebookCookies();
  if (cookies.length === 0) {
    const message = "No facebook.com cookies found. Open Facebook first.";
    await storageSet({
      [STORAGE_KEYS.lastError]: message,
      [STORAGE_KEYS.lastFailureReason]: "no_facebook_cookies",
      [STORAGE_KEYS.lastStatus]: "no_facebook_cookies",
      [STORAGE_KEYS.nextRetryAt]: "",
      [STORAGE_KEYS.retryAttempt]: 0
    });
    return finalizeSyncResult(
      { ok: false, skipped: false, message, status: "no_facebook_cookies" },
      { allowPrompt }
    );
  }

  const fingerprint = await sha256Hex(JSON.stringify(cookies));
  const lastSyncAt = config.lastSyncAt ? Date.parse(config.lastSyncAt) : null;
  if (
    !force
    && config.lastFingerprint === fingerprint
    && lastSyncAt
    && Number.isFinite(lastSyncAt)
    && Date.now() - lastSyncAt < HEARTBEAT_WINDOW_MS
  ) {
    try {
      await sendHeartbeat({ apiBase, helperToken });
      const summary = `Helper checked in after ${reason}. Cookies unchanged.`;
      await storageSet({
        [STORAGE_KEYS.lastError]: "",
        [STORAGE_KEYS.lastFailureReason]: "",
        [STORAGE_KEYS.lastStatus]: "healthy",
        [STORAGE_KEYS.nextRetryAt]: "",
        [STORAGE_KEYS.retryAttempt]: 0,
        [STORAGE_KEYS.lastSyncSummary]: summary
      });
      return finalizeSyncResult({
        ok: true,
        skipped: true,
        message: summary,
        status: "healthy"
      }, { allowPrompt });
    } catch (error) {
      const result = await persistSyncFailure({ error, config, reason });
      return finalizeSyncResult(result, { allowPrompt });
    }
  }

  try {
    const payload = await uploadCookies({ apiBase, helperToken, cookies });
    const summary = payload && payload.helper_label
      ? `Synced ${payload.cookie_count || cookies.length} cookies for ${payload.helper_label}.`
      : `Synced ${payload && payload.cookie_count ? payload.cookie_count : cookies.length} cookies.`;
    await storageSet({
      [STORAGE_KEYS.lastFingerprint]: fingerprint,
      [STORAGE_KEYS.lastSyncAt]: nowIso,
      [STORAGE_KEYS.lastError]: "",
      [STORAGE_KEYS.lastFailureReason]: "",
      [STORAGE_KEYS.lastStatus]: "healthy",
      [STORAGE_KEYS.nextRetryAt]: "",
      [STORAGE_KEYS.retryAttempt]: 0,
      [STORAGE_KEYS.lastSyncSummary]: summary
    });
    return finalizeSyncResult({
      ok: true,
      skipped: false,
      message: summary,
      status: "healthy",
      backendStatus: payload
    }, { allowPrompt });
  } catch (error) {
    const result = await persistSyncFailure({ error, config, reason });
    return finalizeSyncResult(result, { allowPrompt });
  }
}

async function persistSyncFailure({ error, config, reason }) {
  const failure = classifyError(error);
  const previousAttempt = Number(config.retryAttempt || 0);
  const nextAttempt = previousAttempt + 1;
  const shouldRetry = failure.retryable && nextAttempt <= MAX_RETRY_ATTEMPTS;
  const retryAttempt = failure.retryable ? Math.min(nextAttempt, MAX_RETRY_ATTEMPTS) : 0;
  let nextRetryAt = "";

  if (shouldRetry) {
    const delayMs = computeBackoffDelayMs(retryAttempt);
    nextRetryAt = new Date(Date.now() + delayMs).toISOString();
    chrome.alarms.create(RETRY_ALARM_NAME, { when: Date.now() + delayMs });
  }

  const cappedMessage = failure.retryable && !shouldRetry
    ? `${failure.message} Retry cap reached; check your network, then try Sync now.`
    : failure.message;

  await storageSet({
    [STORAGE_KEYS.lastError]: cappedMessage,
    [STORAGE_KEYS.lastFailureReason]: failure.status,
    [STORAGE_KEYS.lastStatus]: failure.status,
    [STORAGE_KEYS.nextRetryAt]: nextRetryAt,
    [STORAGE_KEYS.retryAttempt]: retryAttempt,
    [STORAGE_KEYS.lastSyncSummary]: `Sync failed after ${reason}.`
  });
  return {
    ok: false,
    skipped: false,
    message: cappedMessage,
    status: failure.status,
    retryable: failure.retryable,
    retryAttempt,
    nextRetryAt
  };
}

function isAllowedExternalSender(sender) {
  const senderUrl = String((sender && (sender.url || sender.origin)) || "");
  let parsed;
  try {
    parsed = new URL(senderUrl);
  } catch {
    return false;
  }
  if (parsed.origin === "https://marketly.app") {
    return true;
  }
  if (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname)) {
    return true;
  }
  return false;
}

function appBaseFromSender(sender) {
  const senderUrl = String((sender && (sender.url || sender.origin)) || "");
  try {
    return new URL(senderUrl).origin;
  } catch {
    return "";
  }
}

function externalMessageConfig(message, sender) {
  const config = message && typeof message.config === "object" ? message.config : {};
  const senderAppBase = appBaseFromSender(sender);
  const devApiBase = normalizeApiBase(
    config.devApiBase || config.dev_api_base || message.devApiBase || message.dev_api_base || ""
  );
  const developerMode = Boolean(
    config.developerMode
      || config.developer_mode
      || message.developerMode
      || message.developer_mode
      || devApiBase
  );
  return {
    developerMode,
    devApiBase: devApiBase || DEFAULT_DEVELOPER_API_BASE,
    marketlyAppBase: senderAppBase
  };
}

async function ensureDeveloperApiPermission(apiBase) {
  let originPattern;
  try {
    originPattern = toOriginPattern(apiBase);
  } catch {
    return { ok: false, message: "Developer API base is not a valid URL." };
  }

  const permission = { origins: [originPattern] };
  if (await permissionsContains(permission)) {
    return { ok: true };
  }
  const granted = await permissionsRequest(permission);
  return granted
    ? { ok: true }
    : {
        ok: false,
        message: "Local API permission was not granted. Open the helper popup, allow the local API origin, then retry."
      };
}

async function pairAndSyncFromExternal(message, sender) {
  const pairingCode = String(
    (message && (message.pairingCode || message.pairing_code)) || ""
  ).trim();
  if (!pairingCode) {
    return { ok: false, status: "pairing_code_missing", message: "Pairing code is required." };
  }

  const stored = await getHelperConfig();
  const targetConfig = mergeConfigOverride(stored, externalMessageConfig(message, sender));
  let apiBase = normalizeApiBase(resolveApiBase(targetConfig));
  let targetId = getApiTargetId(targetConfig);
  const isDeveloper = resolveApiMode(targetConfig) === "developer";

  if (isDeveloper) {
    apiBase = normalizeApiBase(targetConfig.devApiBase || DEFAULT_DEVELOPER_API_BASE);
    const validation = validateDeveloperApiBase(apiBase);
    if (!validation.ok) {
      return { ok: false, status: "developer_api_invalid", message: validation.message };
    }
    const permission = await ensureDeveloperApiPermission(apiBase);
    if (!permission.ok) {
      return { ok: false, status: "developer_permission_denied", message: permission.message };
    }
    targetId = getApiTargetId({ ...targetConfig, devApiBase: apiBase });
  }

  let response;
  try {
    response = await fetch(`${apiBase}/connectors/facebook/helper/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairing_code: pairingCode })
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Pairing request failed.";
    return {
      ok: false,
      status: "api_unreachable",
      message: messageText.includes("Failed to fetch")
        ? "Could not reach Marketly. Check your network."
        : messageText
    };
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload || !payload.helper_token) {
    const detail = payload && typeof payload.detail === "string"
      ? payload.detail
      : text || "Pairing failed. Generate a fresh code in Marketly.";
    return { ok: false, status: "pair_failed", message: detail };
  }

  await storageSet({
    [STORAGE_KEYS.developerMode]: isDeveloper,
    [STORAGE_KEYS.devApiBase]: isDeveloper ? apiBase : DEFAULT_DEVELOPER_API_BASE,
    [STORAGE_KEYS.pairedApiTarget]: targetId,
    [STORAGE_KEYS.helperToken]: payload.helper_token,
    [STORAGE_KEYS.helperLabel]: payload.helper_label || "Browser Helper",
    [STORAGE_KEYS.marketlyAppBase]: targetConfig.marketlyAppBase || "",
    [STORAGE_KEYS.lastError]: "",
    [STORAGE_KEYS.lastFailureReason]: "",
    [STORAGE_KEYS.lastStatus]: "paired",
    [STORAGE_KEYS.nextRetryAt]: "",
    [STORAGE_KEYS.retryAttempt]: 0,
    [STORAGE_KEYS.lastSyncSummary]: "Paired successfully. Syncing now..."
  });

  if (message && message.openPopup) {
    await openHelperSurface();
  }

  const syncResult = await syncCookies({
    force: true,
    reason: "external-pair",
    configOverride: {
      helperToken: payload.helper_token,
      developerMode: isDeveloper,
      devApiBase: isDeveloper ? apiBase : DEFAULT_DEVELOPER_API_BASE,
      pairedApiTarget: targetId
    }
  });
  return syncResult && syncResult.ok
    ? { ok: true, status: "healthy", message: syncResult.message || "Helper paired and synced." }
    : {
        ok: false,
        status: (syncResult && syncResult.status) || "sync_failed",
        message: (syncResult && syncResult.message) || "Helper paired, but sync failed."
      };
}

async function syncFromExternal(message, sender) {
  const state = await getHelperConfig();
  const config = externalMessageConfig(message, sender);
  await storageSet({ [STORAGE_KEYS.marketlyAppBase]: config.marketlyAppBase || "" });
  if (message && message.openPopup) {
    await openHelperSurface();
  }
  return syncCookies({
    force: true,
    reason: "external-sync",
    configOverride: {
      helperToken: state.helperToken,
      developerMode: config.developerMode || state.developerMode,
      devApiBase: config.developerMode ? config.devApiBase : state.devApiBase,
      pairedApiTarget: state.pairedApiTarget
    }
  });
}

async function handleExternalMessage(message, sender) {
  if (!isAllowedExternalSender(sender)) {
    return { ok: false, status: "forbidden", message: "Sender is not allowed." };
  }
  if (!message || typeof message !== "object") {
    return { ok: false, status: "invalid_message", message: "Invalid helper message." };
  }
  if (message.type === "marketly-helper-open-popup") {
    const opened = await openHelperSurface();
    return {
      ok: opened,
      status: opened ? "opened" : "unavailable",
      message: opened ? "Helper opened." : "Helper popup could not be opened."
    };
  }
  if (message.type === "marketly-helper-sync-now") {
    return syncFromExternal(message, sender);
  }
  if (message.type === "marketly-helper-pair-and-sync") {
    return pairAndSyncFromExternal(message, sender);
  }
  return { ok: false, status: "unknown_message", message: "Unknown helper message type." };
}

chrome.runtime.onInstalled.addListener(() => {
  createAlarm();
  void syncCookies({ force: true, reason: "install" });
});

chrome.runtime.onStartup.addListener(() => {
  createAlarm();
  void syncCookies({ force: false, reason: "startup" });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void syncCookies({ force: false, reason: "alarm" });
  }
  if (alarm.name === RETRY_ALARM_NAME) {
    void syncCookies({ force: true, reason: "retry" });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "sync-now") {
    void syncCookies({
      force: true,
      reason: "options-sync",
      configOverride: message.config || null
    }).then(sendResponse);
    return true;
  }
  if (message && message.type === "get-helper-state") {
    void getHelperConfig().then(sendResponse);
    return true;
  }
  return false;
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  void handleExternalMessage(message, sender).then(sendResponse);
  return true;
});

if (chrome.notifications && chrome.notifications.onClicked) {
  chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId === ATTENTION_NOTIFICATION_ID) {
      void openHelperSurface();
      void notificationsClear(notificationId);
    }
  });
}

if (chrome.notifications && chrome.notifications.onButtonClicked) {
  chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    if (notificationId !== ATTENTION_NOTIFICATION_ID) {
      return;
    }
    if (buttonIndex === 1) {
      void openFacebookMarketplace();
    } else {
      void openHelperSurface();
    }
    void notificationsClear(notificationId);
  });
}

chrome.storage.onChanged.addListener(() => {
  void getHelperConfig().then(setActionIndicator);
});

void getHelperConfig().then(setActionIndicator);
