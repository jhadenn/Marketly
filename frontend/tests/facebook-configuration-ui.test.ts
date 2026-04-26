import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pageSource = readFileSync(resolve("app/facebook-configuration/page.tsx"), "utf8");

test("facebook configuration renders helper-first recommended UI before manual fallback", () => {
  const recommendedIndex = pageSource.indexOf("Recommended");
  const helperIndex = pageSource.indexOf("Pair Browser Helper");
  const manualIndex = pageSource.indexOf("Manual fallback");

  assert.ok(helperIndex >= 0, "helper setup heading should be present");
  assert.ok(recommendedIndex >= 0, "recommended badge should be present");
  assert.ok(manualIndex >= 0, "manual fallback should remain available");
  assert.ok(helperIndex < manualIndex, "helper setup should appear before manual fallback");
});

test("facebook configuration includes helper refresh guidance and code-only pairing", () => {
  assert.match(
    pageSource,
    /Keep Facebook open occasionally in Chrome\/Edge so helper can refresh on startup and periodic sync/,
  );
  assert.doesNotMatch(pageSource, /Copy API Base/);
  assert.match(pageSource, /Production API built in/);
  assert.match(pageSource, /Copy Pairing Code/);
});
