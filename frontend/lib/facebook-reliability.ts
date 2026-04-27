export type FacebookStaleReason =
  | "helper_disconnected"
  | "cookie_expired"
  | "cookie_expiring_soon"
  | "facebook_session_invalid";

export type FacebookStaleAction = {
  label: "Open Facebook now" | "Open helper & sync" | "Sync now" | "Re-pair helper" | "Re-verify";
  kind: "facebook" | "helper_sync" | "sync" | "pair" | "verify";
  description: string;
};

export const FACEBOOK_STALE_REASON_ACTIONS: Record<FacebookStaleReason, FacebookStaleAction[]> = {
  helper_disconnected: [
    {
      label: "Open Facebook now",
      kind: "facebook",
      description: "Open Facebook in Chrome or Edge so the helper can see an active session.",
    },
    {
      label: "Open helper & sync",
      kind: "helper_sync",
      description: "Ask the installed helper to open and push fresh cookies now.",
    },
    {
      label: "Re-pair helper",
      kind: "pair",
      description: "Fallback only: generate a fresh pairing code if the extension was removed, reset, or revoked.",
    },
  ],
  cookie_expired: [
    {
      label: "Open Facebook now",
      kind: "facebook",
      description: "Log back in or clear any Facebook checkpoint before syncing again.",
    },
    {
      label: "Sync now",
      kind: "sync",
      description: "Use the helper options page to push the refreshed cookie jar immediately.",
    },
  ],
  cookie_expiring_soon: [
    {
      label: "Open Facebook now",
      kind: "facebook",
      description: "Keep Facebook open so startup, periodic sync, and tab activity can refresh cookies.",
    },
    {
      label: "Sync now",
      kind: "sync",
      description: "Trigger the helper manually after Facebook is open.",
    },
  ],
  facebook_session_invalid: [
    {
      label: "Open Facebook now",
      kind: "facebook",
      description: "Resolve Facebook login walls, checkpoints, or account prompts in the browser.",
    },
    {
      label: "Re-verify",
      kind: "verify",
      description: "Ask Marketly to verify the refreshed session after Facebook is usable again.",
    },
  ],
};

export function getFacebookStaleActions(reason?: string | null): FacebookStaleAction[] {
  const normalized = String(reason || "").trim() as FacebookStaleReason;
  return FACEBOOK_STALE_REASON_ACTIONS[normalized] ?? [];
}

export function hasMixedFacebookSources(sources: readonly string[]) {
  const normalized = sources.map((source) => source.trim().toLowerCase()).filter(Boolean);
  return normalized.includes("facebook") && normalized.some((source) => source !== "facebook");
}

export function buildSplitSavedSearchConfigs(query: string, sources: readonly string[]) {
  const normalized = Array.from(
    new Set(sources.map((source) => source.trim().toLowerCase()).filter(Boolean)),
  );
  if (!hasMixedFacebookSources(normalized)) return [];

  const nonFacebookSources = normalized.filter((source) => source !== "facebook");
  return [
    { query, sources: ["facebook"] },
    { query, sources: nonFacebookSources },
  ];
}

export function isLikelyFrontendApiBase(apiBase: string, frontendOrigin: string) {
  try {
    const apiUrl = new URL(apiBase);
    const frontendUrl = new URL(frontendOrigin);
    if (apiUrl.origin !== frontendUrl.origin) return false;
    return !apiUrl.pathname.startsWith("/api");
  } catch {
    return false;
  }
}
