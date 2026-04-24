const ALARM_NAME = "marketly-facebook-sync";
const ALARM_INTERVAL_MINUTES = 15;
const HEARTBEAT_WINDOW_MS = 30 * 60 * 1000;

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

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(payload) {
  return new Promise((resolve) => chrome.storage.local.set(payload, resolve));
}

function createAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_INTERVAL_MINUTES });
}

function normalizeApiBase(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/\/+$/, "");
}

function toOriginPattern(apiBase) {
  const parsed = new URL(normalizeApiBase(apiBase));
  return `${parsed.origin}/*`;
}

function looksLikeFacebookUrl(url) {
  return /^https:\/\/(?:www\.)?facebook\.com\//i.test(url || "")
    || /^https:\/\/(?:www\.)?marketplace\.facebook\.com\//i.test(url || "");
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

function tabsGet(tabId) {
  return new Promise((resolve) => chrome.tabs.get(tabId, resolve));
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
    throw new Error(detail);
  }

  return payload;
}

async function getHelperConfig() {
  return storageGet(Object.values(STORAGE_KEYS));
}

async function syncCookies({ force = false, reason = "manual" } = {}) {
  const config = await getHelperConfig();
  const apiBase = normalizeApiBase(config.apiBase);
  const helperToken = String(config.helperToken || "").trim();
  const nowIso = new Date().toISOString();

  if (!apiBase || !helperToken) {
    return {
      ok: false,
      skipped: true,
      message: "Pair the helper before syncing."
    };
  }

  await storageSet({ [STORAGE_KEYS.lastAttemptAt]: nowIso });

  const cookies = await collectFacebookCookies();
  if (cookies.length === 0) {
    const message = "No facebook.com cookies found. Open Facebook first.";
    await storageSet({ [STORAGE_KEYS.lastError]: message });
    return { ok: false, skipped: false, message };
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
    return {
      ok: true,
      skipped: true,
      message: `Heartbeat skipped after ${reason}.`
    };
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
      [STORAGE_KEYS.lastSyncSummary]: summary
    });
    return {
      ok: true,
      skipped: false,
      message: summary,
      status: payload
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cookie sync failed.";
    await storageSet({
      [STORAGE_KEYS.lastError]: message
    });
    return {
      ok: false,
      skipped: false,
      message
    };
  }
}

async function syncForTab(tabId, reason) {
  const tab = await tabsGet(tabId);
  if (!tab || !looksLikeFacebookUrl(tab.url || "")) {
    return;
  }
  await syncCookies({ force: false, reason });
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
  if (alarm.name !== ALARM_NAME) {
    return;
  }
  void syncCookies({ force: false, reason: "alarm" });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void syncForTab(tabId, "tab-activated");
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !looksLikeFacebookUrl(tab.url || "")) {
    return;
  }
  void syncCookies({ force: false, reason: "tab-updated" });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "sync-now") {
    void syncCookies({ force: true, reason: "options-sync" }).then(sendResponse);
    return true;
  }
  if (message && message.type === "get-helper-state") {
    void getHelperConfig().then(sendResponse);
    return true;
  }
  return false;
});
