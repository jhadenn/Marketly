(function attachMarketlyHelperUtils(root) {
  const PRODUCTION_API_BASE = "https://marketly-backend-870323632900.northamerica-northeast2.run.app";
  const DEFAULT_DEVELOPER_API_BASE = "http://127.0.0.1:8000";
  const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
  const MAX_BACKOFF_MS = 15 * 60 * 1000;

  function normalizeApiBase(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
      return "";
    }
    return trimmed.replace(/\/+$/, "");
  }

  function toOriginPattern(apiBase) {
    const parsed = new URL(normalizeApiBase(apiBase));
    return `${parsed.protocol}//${parsed.hostname}/*`;
  }

  function parseOptionsPrefill(search) {
    const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    return {
      apiBase: normalizeApiBase(
        params.get("dev_api_base")
          || params.get("devApiBase")
          || params.get("apiBase")
          || params.get("api_base")
          || ""
      ),
      pairingCode: String(params.get("pairing_code") || params.get("pairingCode") || "").trim()
    };
  }

  function isDeveloperModeEnabled(state) {
    return state && (state.developerMode === true || state.developerMode === "true");
  }

  function isLoopbackApiBase(value) {
    const apiBase = normalizeApiBase(value);
    let parsed;
    try {
      parsed = new URL(apiBase);
    } catch {
      return false;
    }
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  }

  function validateDeveloperApiBase(value) {
    const apiBase = normalizeApiBase(value || DEFAULT_DEVELOPER_API_BASE);
    if (!apiBase) {
      return { ok: false, message: "Enter a local API base for developer mode." };
    }
    let parsed;
    try {
      parsed = new URL(apiBase);
    } catch {
      return { ok: false, message: "Developer API base must be a full URL such as http://127.0.0.1:8000." };
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      return { ok: false, message: "Developer API base must start with http:// or https://." };
    }
    if (!isLoopbackApiBase(apiBase)) {
      return { ok: false, message: "Developer mode only allows localhost, 127.0.0.1, or ::1 API bases." };
    }
    if (/localhost:3000$|127\.0\.0\.1:3000$/.test(parsed.host)) {
      return {
        ok: true,
        warning: "This looks like the frontend dev server. Local backend is usually http://127.0.0.1:8000."
      };
    }
    return { ok: true, message: "Developer API base looks valid." };
  }

  function resolveApiMode(state) {
    const legacyApiBase = normalizeApiBase(state && state.apiBase);
    if (isDeveloperModeEnabled(state) || (legacyApiBase && isLoopbackApiBase(legacyApiBase))) {
      return "developer";
    }
    return "production";
  }

  function resolveApiBase(state) {
    if (resolveApiMode(state) !== "developer") {
      return PRODUCTION_API_BASE;
    }
    const devApiBase = normalizeApiBase((state && state.devApiBase) || "");
    const legacyApiBase = normalizeApiBase((state && state.apiBase) || "");
    if (devApiBase && isLoopbackApiBase(devApiBase)) return devApiBase;
    if (legacyApiBase && isLoopbackApiBase(legacyApiBase)) return legacyApiBase;
    return DEFAULT_DEVELOPER_API_BASE;
  }

  function getApiTargetId(state) {
    const mode = resolveApiMode(state);
    if (mode === "developer") {
      return `developer:${resolveApiBase(state)}`;
    }
    return "production";
  }

  function getPairedApiTargetId(state) {
    const pairedTarget = String((state && state.pairedApiTarget) || "").trim();
    if (pairedTarget) {
      return pairedTarget;
    }

    const legacyApiBase = normalizeApiBase(state && state.apiBase);
    if (!legacyApiBase) {
      return "";
    }
    if (legacyApiBase === PRODUCTION_API_BASE) {
      return "production";
    }
    if (isLoopbackApiBase(legacyApiBase)) {
      return `developer:${legacyApiBase}`;
    }
    return `legacy:${legacyApiBase}`;
  }

  function classifyError(error) {
    const status = Number(error && error.status);
    const message = error instanceof Error ? error.message : String(error || "Request failed.");
    const lowerMessage = message.toLowerCase();

    if (status === 401 || status === 403 || /invalid helper token|missing or invalid helper token/.test(lowerMessage)) {
      return { status: "token_invalid", retryable: false, message: "Token invalid. Re-pair the helper from Marketly." };
    }
    if (/no facebook\.com cookies|no facebook cookies/.test(lowerMessage)) {
      return { status: "no_facebook_cookies", retryable: false, message: "No Facebook cookies found. Open Facebook, then sync again." };
    }
    if (status && TRANSIENT_HTTP_STATUS.has(status)) {
      return { status: "api_unreachable", retryable: true, message };
    }
    if (/failed to fetch|networkerror|load failed|timeout|temporarily unavailable/i.test(message)) {
      return { status: "api_unreachable", retryable: true, message: "Marketly API unreachable. Check your network, then retry." };
    }
    return { status: "sync_failed", retryable: false, message };
  }

  function computeBackoffDelayMs(attempt, options) {
    const baseMs = Math.max(1, Number(options && options.baseMs) || 30000);
    const maxMs = Math.max(baseMs, Number(options && options.maxMs) || MAX_BACKOFF_MS);
    const jitterRatio = Math.max(0, Number(options && options.jitterRatio) || 0.25);
    const randomValue = Number.isFinite(Number(options && options.randomValue))
      ? Number(options.randomValue)
      : Math.random();
    const normalizedAttempt = Math.max(1, Number(attempt) || 1);
    const exponential = Math.min(maxMs, baseMs * (2 ** (normalizedAttempt - 1)));
    const jitter = exponential * jitterRatio * Math.max(0, Math.min(1, randomValue));
    return Math.min(maxMs, Math.round(exponential + jitter));
  }

  function buildStatusLines(state, extraMessage) {
    const lines = [];
    if (extraMessage) {
      lines.push(extraMessage);
    }

    const helperToken = String((state && state.helperToken) || "").trim();
    const failureReason = String((state && state.lastFailureReason) || "").trim();
    const lastError = String((state && state.lastError) || "").trim();
    const mode = resolveApiMode(state);
    const pairedTarget = getPairedApiTargetId(state);
    const activeTarget = getApiTargetId(state);

    if (!helperToken) {
      lines.push("Status: Not paired");
    } else if (pairedTarget && pairedTarget !== activeTarget) {
      lines.push("Status: Re-pair helper for this API mode.");
    } else if (failureReason === "token_invalid") {
      lines.push("Status: Token invalid - re-pair helper from Marketly.");
    } else if (failureReason === "api_unreachable") {
      lines.push("Status: Marketly API unreachable - check network and retry.");
    } else if (failureReason === "no_facebook_cookies") {
      lines.push("Status: No Facebook cookies found - open Facebook and sync again.");
    } else if (!lastError) {
      lines.push("Status: Paired / healthy");
    } else {
      lines.push("Status: Needs attention");
    }

    lines.push(mode === "developer" ? `API mode: Developer (${resolveApiBase(state)})` : "API mode: Production");
    lines.push(state && state.helperLabel ? `Helper label: ${state.helperLabel}` : "Helper label: not paired");
    lines.push(state && state.lastSyncAt ? `Last sync: ${new Date(state.lastSyncAt).toLocaleString()}` : "Last sync: never");
    lines.push(state && state.lastAttemptAt ? `Last attempt: ${new Date(state.lastAttemptAt).toLocaleString()}` : "Last attempt: never");
    lines.push(state && state.nextRetryAt ? `Next retry: ${new Date(state.nextRetryAt).toLocaleString()}` : "Next retry: none");
    lines.push(state && state.lastSyncSummary ? `Summary: ${state.lastSyncSummary}` : "Summary: no sync yet");
    lines.push(lastError ? `Last error: ${lastError}` : "Last error: none");
    return lines;
  }

  const api = {
    DEFAULT_DEVELOPER_API_BASE,
    PRODUCTION_API_BASE,
    buildStatusLines,
    classifyError,
    computeBackoffDelayMs,
    getApiTargetId,
    getPairedApiTargetId,
    isLoopbackApiBase,
    normalizeApiBase,
    parseOptionsPrefill,
    resolveApiBase,
    resolveApiMode,
    toOriginPattern,
    validateDeveloperApiBase
  };

  root.MarketlyHelperUtils = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
