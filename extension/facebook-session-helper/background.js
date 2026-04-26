importScripts("utils.js");

const ALARM_NAME = "marketly-facebook-sync";
const RETRY_ALARM_NAME = "marketly-facebook-sync-retry";
const ALARM_INTERVAL_MINUTES = 15;
const HEARTBEAT_WINDOW_MS = 30 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 5;

const {
  classifyError,
  computeBackoffDelayMs,
  getApiTargetId,
  getPairedApiTargetId,
  normalizeApiBase,
  resolveApiBase
} = self.MarketlyHelperUtils;

const STORAGE_KEYS = {
  apiBase: "apiBase",
  developerMode: "developerMode",
  devApiBase: "devApiBase",
  pairedApiTarget: "pairedApiTarget",
  helperToken: "helperToken",
  helperLabel: "helperLabel",
  lastFingerprint: "lastFingerprint",
  lastSyncAt: "lastSyncAt",
  lastError: "lastError",
  lastAttemptAt: "lastAttemptAt",
  lastSyncSummary: "lastSyncSummary",
  lastFailureReason: "lastFailureReason",
  lastStatus: "lastStatus",
  nextRetryAt: "nextRetryAt",
  retryAttempt: "retryAttempt"
};

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(payload) {
  return new Promise((resolve) => chrome.storage.local.set(payload, resolve));
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
    .filter((cookie) => (cookie.domain || "").includes("facebook.com"))
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

async function syncCookies({ force = false, reason = "manual", configOverride = null } = {}) {
  const stored = await getHelperConfig();
  const config = mergeConfigOverride(stored, configOverride);
  const apiBase = normalizeApiBase(resolveApiBase(config));
  const activeApiTarget = getApiTargetId(config);
  const pairedApiTarget = getPairedApiTargetId(config);
  const helperToken = String(config.helperToken || "").trim();
  const nowIso = new Date().toISOString();

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
    return {
      ok: false,
      skipped: true,
      message: "Pair the helper before syncing.",
      status: "not_paired"
    };
  }

  if (pairedApiTarget && pairedApiTarget !== activeApiTarget) {
    return {
      ok: false,
      skipped: true,
      message: "This helper token was paired with another API mode. Delete the local token, then pair again.",
      status: "target_mismatch"
    };
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
    return { ok: false, skipped: false, message, status: "no_facebook_cookies" };
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
      return {
        ok: true,
        skipped: true,
        message: summary,
        status: "healthy"
      };
    } catch (error) {
      return persistSyncFailure({ error, config, reason });
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
    return {
      ok: true,
      skipped: false,
      message: summary,
      status: "healthy",
      backendStatus: payload
    };
  } catch (error) {
    return persistSyncFailure({ error, config, reason });
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
