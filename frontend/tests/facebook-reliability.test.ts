import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSplitSavedSearchConfigs,
  getFacebookStaleActions,
  hasMixedFacebookSources,
  isLikelyFrontendApiBase,
} from "../lib/facebook-reliability.ts";

test("stale reason CTA mapping covers direct recovery actions", () => {
  assert.deepEqual(
    getFacebookStaleActions("helper_disconnected").map((action) => action.label),
    ["Open Facebook now", "Open helper & sync", "Re-pair helper"],
  );
  assert.deepEqual(
    getFacebookStaleActions("cookie_expired").map((action) => action.label),
    ["Open Facebook now", "Sync now"],
  );
  assert.deepEqual(
    getFacebookStaleActions("cookie_expiring_soon").map((action) => action.label),
    ["Open Facebook now", "Sync now"],
  );
  assert.deepEqual(
    getFacebookStaleActions("facebook_session_invalid").map((action) => action.label),
    ["Open Facebook now", "Re-verify"],
  );
});

test("split-source recommendation is visible only for mixed Facebook searches", () => {
  assert.equal(hasMixedFacebookSources(["facebook", "ebay"]), true);
  assert.equal(hasMixedFacebookSources(["kijiji", "ebay"]), false);
  assert.equal(hasMixedFacebookSources(["facebook"]), false);
});

test("buildSplitSavedSearchConfigs separates Facebook from healthy non-Facebook sources", () => {
  assert.deepEqual(
    buildSplitSavedSearchConfigs("miata", ["facebook", "kijiji", "ebay"]),
    [
      { query: "miata", sources: ["facebook"] },
      { query: "miata", sources: ["kijiji", "ebay"] },
    ],
  );
});

test("frontend-origin API base warning catches common local mispaste", () => {
  assert.equal(isLikelyFrontendApiBase("http://localhost:3000", "http://localhost:3000"), true);
  assert.equal(isLikelyFrontendApiBase("http://127.0.0.1:8000", "http://localhost:3000"), false);
});
