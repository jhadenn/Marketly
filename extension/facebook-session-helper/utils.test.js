const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildStatusLines,
  classifyError,
  computeBackoffDelayMs,
  getApiTargetId,
  parseOptionsPrefill,
  resolveApiBase,
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
