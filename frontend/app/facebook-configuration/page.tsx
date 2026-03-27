"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Loader2,
  LogOut,
  Sparkles,
  Upload,
} from "lucide-react";

import Dither from "@/components/Dither";
import { useAuth } from "../providers";

type FacebookConnectorStatus = {
  configured: boolean;
  feature_enabled: boolean;
  status?: string | null;
  cookie_count?: number | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  last_validated_at?: string | null;
  last_used_at?: string | null;
  updated_at?: string | null;
};

type FacebookVerifyResponse = {
  ok: boolean;
  status: FacebookConnectorStatus;
  error_code?: string | null;
  error_message?: string | null;
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
      title: "Cookies are saved and usable",
      description: "Your account already has a Facebook cookie export. Re-run Verify any time search starts failing again.",
      panelClassName: "border-emerald-300/20 bg-emerald-400/10",
      badgeClassName: "border-emerald-300/20 bg-emerald-400/15 text-emerald-50",
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
    title: "Waiting for your cookie export",
    description: "Follow the Chrome walkthrough, then upload the exported JSON in this panel.",
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
  const [facebookCookieJsonText, setFacebookCookieJsonText] = useState("");

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
      setFacebookConfigStatus({
        configured: false,
        feature_enabled: facebookConfigStatus?.feature_enabled ?? true,
      });
    } catch (err: unknown) {
      setFacebookConfigError(err instanceof Error ? err.message : "Failed to delete Facebook cookies.");
    } finally {
      setFacebookDeleteBusy(false);
    }
  }, [API_BASE, accessToken, facebookConfigStatus?.feature_enabled, parseApiError]);

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

  useEffect(() => {
    if (!user || !accessToken) {
      setFacebookConfigStatus(null);
      setFacebookConfigError(null);
      setFacebookCookieJsonText("");
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
            Facebook BYOC
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Facebook configuration
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            Upload your Facebook cookie JSON, verify it, and use the walkthrough below if you need help exporting the file from Chrome.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="#setup-card"
              className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-zinc-200"
            >
              Upload cookies
            </Link>
            <Link
              href="#guide"
              className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.06]"
            >
              View walkthrough
            </Link>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Configured" value={configuredValue} helper="Saved for your account" />
            <MetricCard label="Cookies" value={cookieCountValue} helper="Found in the current upload" />
            <MetricCard
              label="Last Verified"
              value={formatTimestamp(facebookConfigStatus?.last_validated_at)}
              helper="Verify again if the session expires"
            />
            <MetricCard
              label="Status"
              value={formatLabel(facebookConfigStatus?.status)}
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
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Upload and verify</h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Once you export the cookie JSON from Chrome, this panel is all you need to finish the setup.
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
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Finish the setup</p>
                <div className="mt-4 space-y-3">
                  <div className="flex gap-3">
                    <div className="mt-0.5 flex size-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[11px] font-semibold text-white">
                      1
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Choose the exported JSON file</p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                        Selecting a file uploads it immediately. Use the manual textarea only if file upload is not convenient.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="mt-0.5 flex size-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[11px] font-semibold text-white">
                      2
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Run Verify session</p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                        This confirms Facebook still accepts the uploaded cookies before you return to Search.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="mt-0.5 flex size-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[11px] font-semibold text-white">
                      3
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Re-export any time the session expires</p>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                        If Facebook logs you out or checkpoints the account, delete the saved cookies and upload a fresh export.
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

                  <div className="space-y-2">
                    <label className="block text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">
                      Upload exported JSON
                    </label>
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
                  </div>

                  <div className="space-y-2">
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
