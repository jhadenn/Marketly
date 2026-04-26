"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  ChevronDown,
  CircleAlert,
  Clipboard,
  ExternalLink,
  Loader2,
  LogOut,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";

import Dither from "@/components/Dither";
import { getFacebookStaleActions } from "@/lib/facebook-reliability";
import { useAuth } from "../providers";

type FacebookConnectorStatus = {
  configured: boolean;
  feature_enabled: boolean;
  status?: string | null;
  cookie_count?: number | null;
  credential_source?: string | null;
  session_cookie_count?: number | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  last_validated_at?: string | null;
  last_used_at?: string | null;
  last_synced_at?: string | null;
  earliest_cookie_expiry_at?: string | null;
  helper_connected?: boolean;
  helper_label?: string | null;
  helper_last_seen_at?: string | null;
  stale_reason?: string | null;
  updated_at?: string | null;
};

type FacebookVerifyResponse = {
  ok: boolean;
  status: FacebookConnectorStatus;
  error_code?: string | null;
  error_message?: string | null;
};

type FacebookHelperPairingSessionResponse = {
  pairing_code: string;
  helper_label: string;
  expires_at: string;
};

type FacebookHelperDeleteResponse = {
  deleted: boolean;
  revoked_clients: number;
};

type GuideScreenshotData = {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption: string;
};

type GuideStep = {
  step: string;
  title: string;
  body: string;
  notes: string[];
  screenshot: GuideScreenshotData;
};

type SetupState = {
  badge: string;
  title: string;
  description: string;
  panelClassName: string;
  badgeClassName: string;
};

const walkthroughSteps: GuideStep[] = [
  {
    step: "01",
    title: "Open Facebook Marketplace while logged in",
    body: "Start in Chrome on facebook.com or marketplace.facebook.com. The active tab should already belong to the Facebook account Marketly should use.",
    notes: [
      "Use the same account whose Marketplace feed you want Marketly to access.",
      "Open DevTools with F12 or right-click and choose Inspect.",
      "Keep the Marketplace tab open while you move into the Application tab.",
    ],
    screenshot: {
      src: "/Marketplace-DevTools.png",
      alt: "Facebook Marketplace open in Chrome with DevTools docked on the right side.",
      width: 1989,
      height: 1270,
      caption:
        "You should see your logged-in Marketplace page and Chrome DevTools at the same time before exporting anything.",
    },
  },
  {
    step: "02",
    title: "Go to Application, then Cookies, then https://www.facebook.com",
    body: "Inside DevTools, switch away from Elements or Network and open the Application tab. In the left sidebar, expand Cookies and click the https://www.facebook.com entry.",
    notes: [
      "You should see a table filled with facebook.com cookie rows once the correct entry is selected.",
      "Export only the facebook.com cookies, not unrelated domains from other tabs or sites.",
      "If the table is nearly empty, you probably selected the wrong cookie scope.",
    ],
    screenshot: {
      src: "/Application-Cookies.png",
      alt: "Chrome DevTools Application tab with Cookies expanded and the facebook.com cookie table visible.",
      width: 1033,
      height: 367,
      caption:
        "This is the exact DevTools area you want. Once the facebook.com row is selected, the cookie table should populate on the right.",
    },
  },
  {
    step: "03",
    title: "Export the entire cookie jar to JSON",
    body: "Save the facebook.com cookies as JSON keeping the structure intact. Marketly accepts either a raw cookie array or an object with a cookies array inside it. In this screenshot, the EditThisCookie chrome extension is being used to export the cookie.",
    notes: [
      "Do not paste individual cookie values or a hand-trimmed file containing only one or two cookies.",
      "The upload should contain valid facebook.com cookie objects and more than a minimal stub.",
      "Store the JSON somewhere private and upload it directly into the setup panel on this page.",
    ],
    screenshot: {
      src: "/ExportCookies.png",
      alt: "Example JSON cookie export showing a facebook.com cookie jar before upload.",
      width: 803,
      height: 637,
      caption:
        "The upload should be a cookie JSON export, not copied rows or manually edited key/value pairs.",
    },
  },
];

const commonIssues = [
  {
    title: "\"Cookie file appears incomplete\"",
    body: "Re-export from Application -> Cookies -> https://www.facebook.com and keep the full cookie jar instead of a tiny subset.",
  },
  {
    title: "Verification fails after upload",
    body: "Your Facebook session may be expired, logged out, or checkpointed. Log back into Facebook, export a fresh cookie file, then verify again.",
  },
  {
    title: "You switched Facebook accounts",
    body: "Delete the saved cookies on this page first, then upload a new export from the account you want Marketly to use.",
  },
];

function GlassPanel({
  className = "",
  children,
  id,
}: {
  className?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={`rounded-[28px] border border-white/10 bg-zinc-950/70 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset] backdrop-blur-xl ${className}`}
    >
      {children}
    </div>
  );
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-3 break-words text-lg font-semibold leading-tight text-white sm:text-xl">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">{helper}</p>
    </div>
  );
}

function GuideScreenshot({ screenshot }: { screenshot: GuideScreenshotData }) {
  return (
    <figure className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
      <div className="mb-3 flex justify-end">
        <a
          href={screenshot.src}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.06]"
        >
          Open full size
          <ExternalLink className="size-3.5" />
        </a>
      </div>
      <Image
        src={screenshot.src}
        alt={screenshot.alt}
        width={screenshot.width}
        height={screenshot.height}
        sizes="(min-width: 1200px) 1000px, (min-width: 768px) 90vw, 100vw"
        className="h-auto w-full rounded-2xl border border-white/10 bg-black"
        priority={screenshot.src === "/Marketplace-DevTools.png"}
      />
      <figcaption className="mt-3 text-sm leading-relaxed text-zinc-400">{screenshot.caption}</figcaption>
    </figure>
  );
}

function formatTimestamp(value?: string | null) {
  if (!value) return "Not yet";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatLabel(value?: string | null) {
  const normalized = (value ?? "").trim();
  if (!normalized) return "Not configured";

  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatStaleReason(reason?: string | null) {
  switch ((reason ?? "").trim()) {
    case "helper_disconnected":
      return "Browser helper disconnected";
    case "cookie_expired":
      return "Session expired";
    case "cookie_expiring_soon":
      return "Session expiring soon";
    case "facebook_session_invalid":
      return "Facebook needs attention";
    default:
      return "Healthy";
  }
}

function describeStaleReason(status: FacebookConnectorStatus | null) {
  const reason = (status?.stale_reason ?? "").trim();
  if (!reason) return null;
  switch (reason) {
    case "helper_disconnected":
      return "The browser helper has stopped checking in. Open Facebook in Chrome or Edge and let the helper sync again, or pair the helper again if you removed the extension.";
    case "cookie_expired":
      return "The saved Facebook session has already expired. Open Facebook again so the helper can refresh it, or upload a new manual export.";
    case "cookie_expiring_soon":
      return "The current Facebook session is about to expire. Leave Facebook open in Chrome or Edge so the helper can refresh the cookie jar.";
    case "facebook_session_invalid":
      return "Facebook challenged the last verification attempt. Open Facebook in your browser, resolve any checkpoint, then let the helper sync again.";
    default:
      return status?.last_error_message ?? "Facebook session needs attention.";
  }
}

function getSetupState({
  authLoading,
  facebookConfigLoading,
  hasUser,
  status,
}: {
  authLoading: boolean;
  facebookConfigLoading: boolean;
  hasUser: boolean;
  status: FacebookConnectorStatus | null;
}): SetupState {
  const statusLabel = (status?.status ?? "").trim().toLowerCase();
  const staleDescription = describeStaleReason(status);

  if (authLoading || (hasUser && facebookConfigLoading)) {
    return {
      badge: "Loading",
      title: "Checking your Facebook setup",
      description: "Marketly is loading the current cookie status for your account.",
      panelClassName: "border-sky-300/20 bg-sky-400/10",
      badgeClassName: "border-sky-300/20 bg-sky-400/15 text-sky-50",
    };
  }

  if (!hasUser) {
    return {
      badge: "Login",
      title: "Login required before upload",
      description: "You can follow the walkthrough right now, but you need to sign in before saving or verifying cookies.",
      panelClassName: "border-sky-300/20 bg-sky-400/10",
      badgeClassName: "border-sky-300/20 bg-sky-400/15 text-sky-50",
    };
  }

  if (status?.feature_enabled === false) {
    return {
      badge: "Disabled",
      title: "Facebook search is off on the server",
      description: "You can still prepare the cookie export, but Marketly will not use Facebook until the feature flag is enabled again.",
      panelClassName: "border-amber-300/20 bg-amber-400/10",
      badgeClassName: "border-amber-300/20 bg-amber-400/15 text-amber-50",
    };
  }

  if (status?.configured && statusLabel === "active") {
    return {
      badge: "Ready",
      title:
        status?.credential_source === "browser_helper"
          ? "Browser helper is connected and syncing"
          : "Cookies are saved and usable",
      description:
        status?.credential_source === "browser_helper"
          ? "Marketly is receiving fresh facebook.com cookies from your local browser helper."
          : "Your account already has a Facebook cookie export. Re-run Verify any time search starts failing again.",
      panelClassName: "border-emerald-300/20 bg-emerald-400/10",
      badgeClassName: "border-emerald-300/20 bg-emerald-400/15 text-emerald-50",
    };
  }

  if (status?.configured && status?.stale_reason) {
    return {
      badge: "Needs attention",
      title:
        status?.credential_source === "browser_helper"
          ? "Browser helper or Facebook session needs attention"
          : "Saved Facebook session needs attention",
      description:
        staleDescription ??
        "Marketly saved your Facebook session, but it needs to be refreshed before saved searches can trust it again.",
      panelClassName: "border-amber-300/20 bg-amber-400/10",
      badgeClassName: "border-amber-300/20 bg-amber-400/15 text-amber-50",
    };
  }

  if (status?.configured && statusLabel && statusLabel !== "active") {
    return {
      badge: formatLabel(status.status),
      title: "Cookies are saved, but need attention",
      description:
        status.last_error_message ??
        "Marketly saved a cookie export for your account, but the last connector status was not active. Verify again or upload a fresh export.",
      panelClassName: "border-amber-300/20 bg-amber-400/10",
      badgeClassName: "border-amber-300/20 bg-amber-400/15 text-amber-50",
    };
  }

  if (status?.configured) {
    return {
      badge: "Configured",
      title: "Cookies are saved",
      description: "If you just uploaded a file, run Verify session next to confirm Facebook still accepts it.",
      panelClassName: "border-sky-300/20 bg-sky-400/10",
      badgeClassName: "border-sky-300/20 bg-sky-400/15 text-sky-50",
    };
  }

  return {
    badge: "Needed",
    title: "Waiting for Browser Helper pairing",
    description: "Generate a pairing code and pair the Chrome or Edge helper before relying on Facebook saved searches.",
    panelClassName: "border-sky-300/20 bg-sky-400/10",
    badgeClassName: "border-sky-300/20 bg-sky-400/15 text-sky-50",
  };
}

export default function FacebookConfigurationPage() {
  const { user, loading: authLoading, signOut, accessToken } = useAuth();
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

  const [facebookConfigStatus, setFacebookConfigStatus] = useState<FacebookConnectorStatus | null>(null);
  const [facebookConfigLoading, setFacebookConfigLoading] = useState(false);
  const [facebookConfigError, setFacebookConfigError] = useState<string | null>(null);
  const [facebookUploadBusy, setFacebookUploadBusy] = useState(false);
  const [facebookVerifyBusy, setFacebookVerifyBusy] = useState(false);
  const [facebookDeleteBusy, setFacebookDeleteBusy] = useState(false);
  const [facebookHelperPairBusy, setFacebookHelperPairBusy] = useState(false);
  const [facebookHelperDeleteBusy, setFacebookHelperDeleteBusy] = useState(false);
  const [facebookCookieJsonText, setFacebookCookieJsonText] = useState("");
  const [facebookHelperLabel, setFacebookHelperLabel] = useState("Chrome helper");
  const [facebookHelperPairing, setFacebookHelperPairing] =
    useState<FacebookHelperPairingSessionResponse | null>(null);
  const [facebookCopyMessage, setFacebookCopyMessage] = useState<string | null>(null);

  const parseApiError = useCallback(async (res: Response, fallback: string) => {
    const text = await res.text();
    if (!text) return fallback;
    try {
      const parsed = JSON.parse(text) as
        | { detail?: string | { message?: string } | { error_message?: string } }
        | undefined;
      const detail = parsed?.detail as
        | string
        | { message?: string; error_message?: string }
        | undefined;
      if (typeof detail === "string" && detail.trim()) return detail;
      if (detail && typeof detail === "object") {
        if (typeof detail.message === "string" && detail.message.trim()) return detail.message;
        if (typeof detail.error_message === "string" && detail.error_message.trim()) {
          return detail.error_message;
        }
      }
    } catch {
      return text;
    }
    return fallback;
  }, []);

  const fetchFacebookConfigStatus = useCallback(async (): Promise<FacebookConnectorStatus | null> => {
    if (!accessToken) {
      setFacebookConfigStatus(null);
      return null;
    }

    setFacebookConfigLoading(true);
    setFacebookConfigError(null);
    try {
      const res = await fetch(`${API_BASE}/me/connectors/facebook`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to load Facebook setup status."));
      }
      const json = (await res.json()) as FacebookConnectorStatus;
      setFacebookConfigStatus(json);
      return json;
    } catch (err: unknown) {
      setFacebookConfigError(err instanceof Error ? err.message : "Failed to load Facebook setup status.");
      return null;
    } finally {
      setFacebookConfigLoading(false);
    }
  }, [API_BASE, accessToken, parseApiError]);

  const uploadFacebookCookiePayload = useCallback(
    async (cookiePayload: unknown) => {
      if (!accessToken) {
        setFacebookConfigError("Please log in to configure Facebook cookies.");
        return;
      }
      setFacebookUploadBusy(true);
      setFacebookConfigError(null);
      try {
        const res = await fetch(`${API_BASE}/me/connectors/facebook/cookies`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ cookies_json: cookiePayload }),
        });
        if (!res.ok) {
          throw new Error(await parseApiError(res, "Failed to save Facebook cookies."));
        }
        const json = (await res.json()) as FacebookConnectorStatus;
        setFacebookConfigStatus(json);
        setFacebookCookieJsonText("");
      } catch (err: unknown) {
        setFacebookConfigError(err instanceof Error ? err.message : "Failed to save Facebook cookies.");
      } finally {
        setFacebookUploadBusy(false);
      }
    },
    [API_BASE, accessToken, parseApiError],
  );

  const onSaveFacebookCookieJson = useCallback(async () => {
    if (!facebookCookieJsonText.trim()) {
      setFacebookConfigError("Paste your Facebook cookie JSON first.");
      return;
    }
    try {
      const parsed = JSON.parse(facebookCookieJsonText);
      await uploadFacebookCookiePayload(parsed);
    } catch {
      setFacebookConfigError("Cookie JSON is not valid JSON.");
    }
  }, [facebookCookieJsonText, uploadFacebookCookiePayload]);

  const onVerifyFacebookCookies = useCallback(async () => {
    if (!accessToken) {
      setFacebookConfigError("Please log in to verify Facebook cookies.");
      return;
    }
    setFacebookVerifyBusy(true);
    setFacebookConfigError(null);
    try {
      const res = await fetch(`${API_BASE}/me/connectors/facebook/verify`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to verify Facebook cookies."));
      }
      const json = (await res.json()) as FacebookVerifyResponse;
      setFacebookConfigStatus(json.status);
      if (!json.ok) {
        setFacebookConfigError(json.error_message || "Facebook cookie verification failed.");
      }
    } catch (err: unknown) {
      setFacebookConfigError(err instanceof Error ? err.message : "Failed to verify Facebook cookies.");
    } finally {
      setFacebookVerifyBusy(false);
    }
  }, [API_BASE, accessToken, parseApiError]);

  const onDeleteFacebookCookies = useCallback(async () => {
    if (!accessToken) {
      setFacebookConfigError("Please log in to delete Facebook cookies.");
      return;
    }
    setFacebookDeleteBusy(true);
    setFacebookConfigError(null);
    try {
      const res = await fetch(`${API_BASE}/me/connectors/facebook`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to delete Facebook cookies."));
      }
      setFacebookHelperPairing(null);
      await fetchFacebookConfigStatus();
    } catch (err: unknown) {
      setFacebookConfigError(err instanceof Error ? err.message : "Failed to delete Facebook cookies.");
    } finally {
      setFacebookDeleteBusy(false);
    }
  }, [API_BASE, accessToken, fetchFacebookConfigStatus, parseApiError]);

  const onCreateFacebookHelperPairing = useCallback(async () => {
    if (!accessToken) {
      setFacebookConfigError("Please log in to pair the Facebook browser helper.");
      return;
    }
    setFacebookHelperPairBusy(true);
    setFacebookConfigError(null);
    try {
      const res = await fetch(`${API_BASE}/me/connectors/facebook/helper/pairing-sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ helper_label: facebookHelperLabel }),
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to create a helper pairing code."));
      }
      const json = (await res.json()) as FacebookHelperPairingSessionResponse;
      setFacebookHelperPairing(json);
      setFacebookCopyMessage("Pairing code ready. Copy it into the helper options page.");
    } catch (err: unknown) {
      setFacebookConfigError(err instanceof Error ? err.message : "Failed to create a helper pairing code.");
    } finally {
      setFacebookHelperPairBusy(false);
    }
  }, [API_BASE, accessToken, facebookHelperLabel, parseApiError]);

  const onDeleteFacebookHelper = useCallback(async () => {
    if (!accessToken) {
      setFacebookConfigError("Please log in to disconnect the Facebook browser helper.");
      return;
    }
    setFacebookHelperDeleteBusy(true);
    setFacebookConfigError(null);
    try {
      const res = await fetch(`${API_BASE}/me/connectors/facebook/helper`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to disconnect the browser helper."));
      }
      void ((await res.json()) as FacebookHelperDeleteResponse);
      await fetchFacebookConfigStatus();
    } catch (err: unknown) {
      setFacebookConfigError(err instanceof Error ? err.message : "Failed to disconnect the browser helper.");
    } finally {
      setFacebookHelperDeleteBusy(false);
    }
  }, [API_BASE, accessToken, fetchFacebookConfigStatus, parseApiError]);

  const onFacebookCookieFileSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.currentTarget.value = "";
      if (!file) return;
      void (async () => {
        setFacebookConfigError(null);
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          await uploadFacebookCookiePayload(parsed);
        } catch {
          setFacebookConfigError("Failed to read or parse the selected cookie JSON file.");
        }
      })();
    },
    [uploadFacebookCookiePayload],
  );

  const copySetupValue = useCallback(async (label: string, value?: string | null) => {
    const normalized = String(value || "").trim();
    if (!normalized) {
      setFacebookCopyMessage(`${label} is not available yet.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(normalized);
      setFacebookCopyMessage(`${label} copied.`);
    } catch {
      setFacebookCopyMessage(`Copy failed. Select and copy the ${label.toLowerCase()} manually.`);
    }
  }, []);

  useEffect(() => {
    if (!user || !accessToken) {
      setFacebookConfigStatus(null);
      setFacebookConfigError(null);
      setFacebookCookieJsonText("");
      setFacebookHelperPairing(null);
      return;
    }
    void fetchFacebookConfigStatus();
  }, [user, accessToken, fetchFacebookConfigStatus]);

  const setupState = getSetupState({
    authLoading,
    facebookConfigLoading,
    hasUser: Boolean(user),
    status: facebookConfigStatus,
  });
  const configuredValue = authLoading ? "..." : facebookConfigStatus?.configured ? "Yes" : "No";
  const cookieCountValue =
    facebookConfigStatus?.cookie_count != null ? String(facebookConfigStatus.cookie_count) : user ? "0" : "-";
  const featureDisabled = facebookConfigStatus?.feature_enabled === false;
  const lastConnectorMessage =
    !facebookConfigError && facebookConfigStatus?.last_error_message ? facebookConfigStatus.last_error_message : null;
  const staleReasonDescription = describeStaleReason(facebookConfigStatus);
  const staleActions = getFacebookStaleActions(facebookConfigStatus?.stale_reason);
  const credentialSourceValue = formatLabel(facebookConfigStatus?.credential_source);
  const helperStateValue = facebookConfigStatus?.helper_connected
    ? "Connected"
    : facebookConfigStatus?.helper_label
      ? "Disconnected"
      : "Not paired";

  return (
    <main className="dark relative min-h-screen overflow-x-hidden bg-black text-white antialiased">
      <div className="pointer-events-none fixed inset-0 -z-20 opacity-20">
        <Dither
          waveColor={[0.30980392156862746, 0.30980392156862746, 0.30980392156862746]}
          disableAnimation
          enableMouseInteraction={false}
          mouseRadius={0.25}
          colorNum={4}
          pixelSize={2}
          waveAmplitude={0.3}
          waveFrequency={3}
          waveSpeed={0.05}
        />
      </div>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_10%_10%,rgba(255,255,255,0.07),transparent_40%),radial-gradient(circle_at_92%_4%,rgba(56,189,248,0.12),transparent_30%),radial-gradient(circle_at_78%_88%,rgba(16,185,129,0.10),transparent_35%),radial-gradient(circle_at_50%_90%,rgba(255,255,255,0.04),transparent_45%)]" />

      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/70 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href="/search"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.04]"
            >
              <ArrowLeft className="size-4" />
              Search
            </Link>
            <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-300 sm:inline-flex">
              <Sparkles className="size-3.5 text-zinc-400" />
              Facebook Configuration
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="hidden rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.04] sm:inline-flex"
            >
              Home
            </Link>

            {authLoading ? (
              <span className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-400">
                Loading auth...
              </span>
            ) : user ? (
              <details className="relative">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden">
                  <span className="hidden max-w-[220px] truncate sm:inline">{user.email ?? "Signed in"}</span>
                  <span className="sm:hidden">Account</span>
                  <ChevronDown className="size-3.5 text-zinc-400" />
                </summary>
                <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 p-1 shadow-2xl backdrop-blur-xl">
                  <Link
                    href="/search"
                    className="block rounded-xl px-3 py-2 text-sm text-zinc-200 transition hover:bg-white/[0.05]"
                  >
                    Back to search
                  </Link>
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-white/[0.05]"
                  >
                    <LogOut className="size-4 text-zinc-400" />
                    Logout
                  </button>
                </div>
              </details>
            ) : (
              <Link
                href="/login"
                className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-zinc-200"
              >
                Login
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1280px] px-4 pb-20 pt-6 sm:px-6 lg:px-8">
        <GlassPanel className="p-6 sm:p-8">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-300">
            <Sparkles className="size-3.5 text-zinc-400" />
            Facebook Helper
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Pair Browser Helper
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            Recommended for saved searches: pair the Chrome or Edge helper so Marketly can keep your Facebook session fresh without repeated cookie exports. Keep Facebook open occasionally in Chrome/Edge so helper can refresh on startup and periodic sync.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="#setup-card"
              className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-zinc-200"
            >
              Pair Browser Helper
            </Link>
            <Link
              href="#guide"
              className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.06]"
            >
              Manual fallback
            </Link>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Configured" value={configuredValue} helper="Saved for your account" />
            <MetricCard
              label="Source"
              value={credentialSourceValue}
              helper="Manual upload or browser helper"
            />
            <MetricCard
              label="Helper"
              value={helperStateValue}
              helper={
                facebookConfigStatus?.helper_label
                  ? `${facebookConfigStatus.helper_label}${facebookConfigStatus?.helper_connected ? " is checking in" : " needs attention"}`
                  : "Pair the Chrome or Edge helper"
              }
            />
            <MetricCard
              label="Last Sync"
              value={formatTimestamp(facebookConfigStatus?.last_synced_at)}
              helper="Most recent helper cookie upload"
            />
            <MetricCard
              label="Last Attempt"
              value={formatTimestamp(facebookConfigStatus?.helper_last_seen_at)}
              helper="Most recent helper check-in"
            />
            <MetricCard label="Cookies" value={cookieCountValue} helper="Found in the current upload" />
            <MetricCard
              label="Last Verified"
              value={formatTimestamp(facebookConfigStatus?.last_validated_at)}
              helper="Verify again if the session expires"
            />
            <MetricCard
              label="Status"
              value={facebookConfigStatus?.stale_reason ? formatStaleReason(facebookConfigStatus?.stale_reason) : formatLabel(facebookConfigStatus?.status)}
              helper={featureDisabled ? "Facebook is disabled on the server" : "Current connector state"}
            />
          </div>
        </GlassPanel>

        {featureDisabled ? (
          <div className="mt-6 rounded-[24px] border border-amber-300/20 bg-amber-400/10 p-4 text-sm text-amber-50">
            Facebook search is currently disabled by server configuration. You can still follow the tutorial and
            prepare an upload, but the Facebook source will not run until the server flag is enabled again.
          </div>
        ) : null}

        <div className="mt-6 space-y-6">
          <GlassPanel id="setup-card" className="p-5 sm:p-6">
            <div className="space-y-5">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-zinc-400" />
                  <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">Setup workspace</p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <h2 className="text-2xl font-semibold tracking-tight text-white">Pair Browser Helper</h2>
                  <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-emerald-100">
                    Recommended
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Generate a pairing code and pair the extension. Manual cookie upload stays available below as a fallback.
                </p>
              </div>

              <div className={`rounded-[24px] border p-4 ${setupState.panelClassName}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">{setupState.title}</p>
                    <p className="mt-2 text-sm leading-relaxed text-white/80">{setupState.description}</p>
                  </div>
                  <span
                    className={`inline-flex w-fit rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${setupState.badgeClassName}`}
                  >
                    {setupState.badge}
                  </span>
                </div>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Recommended flow</p>
                <div className="mt-4 space-y-3">
                  <div className="flex gap-3">
                    <div className="mt-0.5 flex size-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[11px] font-semibold text-white">
                      1
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Generate a pairing code for the browser helper</p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                        Pair once from this page, then let the Chrome or Edge helper keep your Facebook session fresh automatically.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="mt-0.5 flex size-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[11px] font-semibold text-white">
                      2
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Leave Facebook open in Chrome or Edge</p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                        Keep Facebook open occasionally in Chrome/Edge so helper can refresh on startup and periodic sync.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="mt-0.5 flex size-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[11px] font-semibold text-white">
                      3
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Fallback to manual upload any time</p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                        Manual JSON upload still works if you do not want the helper, or if you need to recover quickly after a Facebook checkpoint.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {authLoading ? (
                <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-400">
                  Checking account status...
                </div>
              ) : !user ? (
                <div className="rounded-[24px] border border-sky-300/20 bg-sky-400/10 p-4 text-sm text-sky-50">
                  <p>Sign in to save or verify Facebook cookies for your account.</p>
                  <Link href="/login" className="mt-3 inline-flex text-xs font-medium underline underline-offset-4">
                    Go to login
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {facebookConfigError ? (
                    <div className="rounded-[24px] border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-100">
                      {facebookConfigError}
                    </div>
                  ) : null}

                  {lastConnectorMessage ? (
                    <div className="rounded-[24px] border border-amber-300/20 bg-amber-400/10 p-4 text-sm text-amber-50">
                      <p className="font-medium">Most recent connector note</p>
                      <p className="mt-2 leading-relaxed">{lastConnectorMessage}</p>
                    </div>
                  ) : null}

                  {staleReasonDescription ? (
                    <div className="rounded-[24px] border border-amber-300/20 bg-amber-400/10 p-4 text-sm text-amber-50">
                      <p className="font-medium">Current recovery step</p>
                      <p className="mt-2 leading-relaxed">{staleReasonDescription}</p>
                      {staleActions.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {staleActions.map((action) =>
                            action.kind === "facebook" ? (
                              <a
                                key={action.label}
                                href="https://www.facebook.com/marketplace/"
                                target="_blank"
                                rel="noreferrer"
                                title={action.description}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs font-medium text-black transition hover:bg-zinc-200"
                              >
                                <ExternalLink className="size-3.5" />
                                {action.label}
                              </a>
                            ) : (
                              <button
                                key={action.label}
                                type="button"
                                title={action.description}
                                onClick={() => {
                                  if (action.kind === "pair") {
                                    void onCreateFacebookHelperPairing();
                                  } else if (action.kind === "verify") {
                                    void onVerifyFacebookCookies();
                                  } else {
                                    setFacebookCopyMessage("Open the helper options page with Facebook open, then click Sync now.");
                                  }
                                }}
                                disabled={
                                  (action.kind === "pair" && facebookHelperPairBusy)
                                  || (action.kind === "verify" && facebookVerifyBusy)
                                }
                                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-100/20 bg-amber-50/10 px-3 py-2 text-xs font-medium text-amber-50 transition hover:border-amber-100/30 hover:bg-amber-50/15 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {action.kind === "sync" ? <RefreshCw className="size-3.5" /> : null}
                                {action.label}
                              </button>
                            ),
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {facebookCopyMessage ? (
                    <div className="rounded-[24px] border border-sky-300/20 bg-sky-400/10 p-4 text-sm text-sky-50">
                      {facebookCopyMessage}
                    </div>
                  ) : null}

                  <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="max-w-2xl">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Browser helper</p>
                        <h3 className="mt-2 text-lg font-semibold text-white">Pair Chrome or Edge once</h3>
                        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                          This is the reliable path for hosted Marketly. The helper keeps uploading fresh <span className="font-mono text-zinc-300">facebook.com</span> cookies from your local logged-in browser so saved searches do not rely on a static export.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-400">
                        Extension path: <span className="font-mono text-zinc-200">extension/facebook-session-helper</span>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <div className="space-y-3">
                        <label className="block text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">
                          Helper label
                        </label>
                        <input
                          value={facebookHelperLabel}
                          onChange={(e) => setFacebookHelperLabel(e.target.value)}
                          placeholder="Chrome helper"
                          className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-white/20 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void onCreateFacebookHelperPairing()}
                          disabled={facebookHelperPairBusy || authLoading || !user}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-xs font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {facebookHelperPairBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                          {facebookHelperPairBusy ? "Creating code..." : "Generate pairing code"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteFacebookHelper()}
                          disabled={facebookHelperDeleteBusy || !facebookConfigStatus?.helper_label || !user}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-300/20 bg-red-400/10 px-4 py-2.5 text-xs text-red-100 transition hover:border-red-300/30 hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {facebookHelperDeleteBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                          Disconnect helper
                        </button>
                      </div>

                      <div className="rounded-[24px] border border-white/10 bg-black/30 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Extension setup</p>
                          <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-emerald-100">
                            Production API built in
                          </span>
                        </div>
                        {facebookHelperPairing ? (
                          <div className="mt-3 space-y-3">
                            <div>
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs text-zinc-400">Pairing code</p>
                                <button
                                  type="button"
                                  onClick={() => void copySetupValue("Pairing Code", facebookHelperPairing.pairing_code)}
                                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.07]"
                                >
                                  <Clipboard className="size-3.5" />
                                  Copy Pairing Code
                                </button>
                              </div>
                              <p className="mt-2 break-all rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-sm text-white">
                                {facebookHelperPairing.pairing_code}
                              </p>
                            </div>
                            <p className="text-xs leading-relaxed text-zinc-400">
                              Expires {formatTimestamp(facebookHelperPairing.expires_at)}. In the extension options page,
                              paste this code and click Pair helper. The options page also accepts a <span className="font-mono text-zinc-200">pairing_code</span> query param for prefill.
                            </p>
                          </div>
                        ) : (
                          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                            Generate a code here, then open the unpacked extension options page. The production API endpoint is already built into the helper.
                          </p>
                        )}
                        <ol className="mt-4 space-y-2 text-xs leading-relaxed text-zinc-400">
                          <li>1. Load the unpacked extension from <span className="font-mono text-zinc-200">extension/facebook-session-helper</span>.</li>
                          <li>2. Open the extension options page.</li>
                          <li>3. Paste the pairing code, then click Pair helper.</li>
                          <li>4. Open Facebook in Chrome or Edge occasionally so startup and periodic sync can refresh the saved session.</li>
                        </ol>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-white/10 bg-white/[0.02] p-4 opacity-90">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Manual fallback</p>
                        <p className="mt-1 text-sm font-medium text-white">Upload exported JSON</p>
                      </div>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-300">
                        Fallback
                      </span>
                    </div>
                    <label
                      className={`group flex cursor-pointer items-center gap-4 rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] p-4 transition ${
                        facebookUploadBusy ? "pointer-events-none opacity-70" : "hover:border-white/20 hover:bg-white/[0.05]"
                      }`}
                    >
                      <input
                        type="file"
                        accept=".json,application/json"
                        onChange={onFacebookCookieFileSelected}
                        disabled={facebookUploadBusy}
                        className="sr-only"
                      />
                      <div className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-zinc-100">
                        {facebookUploadBusy ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">
                          {facebookUploadBusy ? "Uploading cookie file..." : "Choose Facebook cookie JSON"}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                          Selecting a file starts the upload immediately. Export only the facebook.com cookie jar.
                        </p>
                      </div>
                      <span className="ml-auto hidden rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-100 sm:inline-flex">
                        {facebookUploadBusy ? "Working" : "Browse"}
                      </span>
                    </label>

                    <div className="mt-4 space-y-2">
                      <label className="block text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">
                        Paste JSON manually
                      </label>
                      <textarea
                        value={facebookCookieJsonText}
                        onChange={(e) => setFacebookCookieJsonText(e.target.value)}
                        placeholder='[{"name":"c_user","domain":".facebook.com","value":"..."}, ...]'
                        className="min-h-36 w-full rounded-[24px] border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:border-white/20 focus:outline-none"
                      />
                      <p className="text-xs leading-relaxed text-zinc-500">
                        Fallback only. Marketly accepts a raw cookie array or an object shaped like
                        {" "}
                        <span className="font-mono text-zinc-400">{`{"cookies":[...]}`}</span>.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => void onSaveFacebookCookieJson()}
                      disabled={facebookUploadBusy || authLoading || !user || !facebookCookieJsonText.trim()}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-3 py-2.5 text-xs font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {facebookUploadBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      Save pasted JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => void onVerifyFacebookCookies()}
                      disabled={facebookVerifyBusy || !facebookConfigStatus?.configured || !user}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {facebookVerifyBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      Verify session
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteFacebookCookies()}
                      disabled={facebookDeleteBusy || !facebookConfigStatus?.configured || !user}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-300/20 bg-red-400/10 px-3 py-2.5 text-xs text-red-100 transition hover:border-red-300/30 hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {facebookDeleteBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      Delete saved cookies
                    </button>
                  </div>

                  {facebookConfigStatus?.configured ? (
                    <Link
                      href="/search"
                      className="inline-flex items-center gap-2 text-sm text-zinc-300 underline underline-offset-4 transition hover:text-white"
                    >
                      Return to search once verification passes
                    </Link>
                  ) : null}
                </div>
              )}

              <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                <p className="text-sm font-medium text-white">Handle the export like a password</p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Marketly stores uploaded cookies encrypted for your account. Keep your JSON private, do not commit
                  it to source control, and rotate it whenever you change or secure the Facebook account.
                </p>
              </div>
            </div>
          </GlassPanel>

          <div id="guide" className="space-y-6 scroll-mt-24">
            <GlassPanel className="p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-zinc-400" />
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">Chrome walkthrough</p>
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">How to export Facebook cookies</h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
                Follow the steps in order. Each screenshot is shown full width below the instruction it belongs to.
              </p>

              <ol className="mt-8 space-y-10">
                {walkthroughSteps.map((step) => (
                  <li key={step.step} className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-sm font-semibold text-white">
                        {step.step}
                      </div>
                      <h3 className="text-xl font-semibold tracking-tight text-white">{step.title}</h3>
                    </div>

                    <p className="text-sm leading-relaxed text-zinc-300">{step.body}</p>

                    <ul className="space-y-2 text-sm text-zinc-400">
                      {step.notes.map((note) => (
                        <li key={`${step.step}-${note}`} className="flex gap-3">
                          <BadgeCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" />
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>

                    <GuideScreenshot screenshot={step.screenshot} />
                  </li>
                ))}
              </ol>
            </GlassPanel>

            <GlassPanel className="p-5 sm:p-6">
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-zinc-400" />
                    <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">Accepted JSON</p>
                  </div>
                  <h2 className="mt-3 text-xl font-semibold tracking-tight text-white">What to upload</h2>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                    Upload the full <span className="font-mono">facebook.com</span> cookie jar. Marketly accepts either of these shapes:
                  </p>
                  <div className="mt-4 space-y-3">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="font-mono text-[11px] leading-6 text-zinc-300">{`[{"name":"c_user",...},{"name":"xs",...}, ...]`}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <p className="font-mono text-[11px] leading-6 text-zinc-300">{`{"cookies":[{"name":"c_user",...},{"name":"xs",...}, ...]}`}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <CircleAlert className="size-4 text-zinc-400" />
                    <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">Common problems</p>
                  </div>
                  <div className="mt-4 space-y-3">
                    {commonIssues.map((issue) => (
                      <div key={issue.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <p className="text-sm font-medium text-white">{issue.title}</p>
                        <p className="mt-2 text-sm leading-relaxed text-zinc-400">{issue.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </GlassPanel>
          </div>
        </div>
      </div>
    </main>
  );
}
