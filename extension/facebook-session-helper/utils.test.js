const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ATTENTION_PROMPT_THROTTLE_MS,
  buildMarketlyAppUrl,
  buildStatusLines,
  classifyError,
  computeBackoffDelayMs,
  getApiTargetId,
  getHelperAttentionDescriptor,
  parseOptionsPrefill,
  resolveApiBase,
  shouldPromptForAttention,
  validateDeveloperApiBase
} = require("./utils.js");

test("parseOptionsPrefill reads developer api base and pairing_code query params", () => {
  const parsed = parseOptionsPrefill("?dev_api_base=http%3A%2F%2F127.0.0.1%3A8000&pairing_code=abc123");

  assert.equal(parsed.apiBase, "http://127.0.0.1:8000");
  assert.equal(parsed.pairingCode, "abc123");
});

test("production API base is fixed unless developer mode is enabled", () => {
  assert.equal(
    resolveApiBase({}),
    "https://marketly-backend-870323632900.northamerica-northeast2.run.app",
  );
  assert.equal(
    resolveApiBase({ developerMode: true, devApiBase: "http://127.0.0.1:8000/" }),
    "http://127.0.0.1:8000",
  );
  assert.equal(
    resolveApiBase({ developerMode: true, devApiBase: "https://api.example.com" }),
    "http://127.0.0.1:8000",
  );
  assert.equal(getApiTargetId({}), "production");
  assert.equal(
    getApiTargetId({ developerMode: true, devApiBase: "http://127.0.0.1:8000" }),
    "developer:http://127.0.0.1:8000",
  );
});

test("computeBackoffDelayMs applies exponential backoff and jitter", () => {
  assert.equal(
    computeBackoffDelayMs(3, { baseMs: 1000, maxMs: 10000, jitterRatio: 0.25, randomValue: 0.5 }),
    4500,
  );
});

test("classifyError marks token failures as non-retryable", () => {
  const error = new Error("Missing or invalid helper token");
  error.status = 401;

  const classified = classifyError(error);

  assert.equal(classified.status, "token_invalid");
  assert.equal(classified.retryable, false);
  assert.match(classified.message, /Re-pair/);
});

test("buildStatusLines exposes actionable states", () => {
  assert.match(buildStatusLines({}, "").join("\n"), /Status: Not paired/);
  assert.match(
    buildStatusLines({ helperToken: "token", lastFailureReason: "api_unreachable" }, "").join("\n"),
    /Status: Marketly API unreachable/,
  );
  assert.match(
    buildStatusLines({ helperToken: "token", lastFailureReason: "no_facebook_cookies" }, "").join("\n"),
    /Status: No Facebook cookies found/,
  );
  assert.match(
    buildStatusLines({ helperToken: "token", lastError: "" }, "").join("\n"),
    /Status: Paired \/ healthy/,
  );
  assert.match(
    buildStatusLines({
      helperToken: "token",
      pairedApiTarget: "developer:http://127.0.0.1:8000",
      developerMode: false,
    }, "").join("\n"),
    /Status: Re-pair helper/,
  );
});

test("validateDeveloperApiBase only accepts loopback origins", () => {
  const validation = validateDeveloperApiBase("http://localhost:3000");

  assert.equal(validation.ok, true);
  assert.match(validation.warning, /frontend dev server/);

  const remote = validateDeveloperApiBase("https://api.example.com");
  assert.equal(remote.ok, false);
  assert.match(remote.message, /localhost/);
});

test("attention descriptor treats desync as sync recovery before re-pairing", () => {
  const missingCookies = getHelperAttentionDescriptor({
    helperToken: "token",
    lastFailureReason: "no_facebook_cookies",
  });
  assert.equal(missingCookies.reason, "no_facebook_cookies");
  assert.equal(missingCookies.preferredAction, "open_facebook");
  assert.equal(missingCookies.prompt, true);

  const targetMismatch = getHelperAttentionDescriptor({
    helperToken: "token",
    pairedApiTarget: "developer:http://127.0.0.1:8000",
    developerMode: false,
  });
  assert.equal(targetMismatch.reason, "target_mismatch");
  assert.equal(targetMismatch.preferredAction, "open_helper");
});

test("attention prompts are throttled per reason", () => {
  const descriptor = { reason: "no_facebook_cookies", prompt: true };
  const now = Date.parse("2026-04-27T12:00:00.000Z");

  assert.equal(shouldPromptForAttention({}, descriptor, now), true);
  assert.equal(
    shouldPromptForAttention(
      {
        lastAttentionReason: "no_facebook_cookies",
        lastAttentionPromptAt: new Date(now - ATTENTION_PROMPT_THROTTLE_MS + 1000).toISOString(),
      },
      descriptor,
      now,
    ),
    false,
  );
  assert.equal(
    shouldPromptForAttention(
      {
        lastAttentionReason: "token_invalid",
        lastAttentionPromptAt: new Date(now - 1000).toISOString(),
      },
      descriptor,
      now,
    ),
    true,
  );
});

test("marketly app URL resolves production and developer targets", () => {
  assert.equal(buildMarketlyAppUrl({}, "/facebook-configuration"), "https://marketly.app/facebook-configuration");
  assert.equal(
    buildMarketlyAppUrl(
      {
        developerMode: true,
        marketlyAppBase: "http://localhost:3000/",
      },
      "/facebook-configuration",
    ),
    "http://localhost:3000/facebook-configuration",
  );
});
