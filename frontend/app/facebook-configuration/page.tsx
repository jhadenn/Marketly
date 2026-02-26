"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ImageIcon,
  Loader2,
  LogOut,
  Sparkles,
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

function GlassPanel({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-zinc-950/70 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset] backdrop-blur-xl ${className}`}
    >
      {children}
    </div>
  );
}

function PlaceholderShot({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex aspect-[16/10] items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/30">
        <div className="text-center">
          <ImageIcon className="mx-auto size-6 text-zinc-500" />
          <p className="mt-2 text-xs font-medium text-zinc-300">{title}</p>
          <p className="mt-1 text-[11px] text-zinc-500">Placeholder image (replace with screenshot)</p>
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">{caption}</p>
    </div>
  );
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
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_10%_10%,rgba(255,255,255,0.07),transparent_40%),radial-gradient(circle_at_90%_0%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_50%_90%,rgba(255,255,255,0.04),transparent_45%)]" />

      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/70 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
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

      <div className="mx-auto max-w-[1200px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <GlassPanel className="mb-6 overflow-hidden p-5 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
                <Sparkles className="size-3.5 text-zinc-400" />
                BYOC (Bring Your Own Cookie)
              </p>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Facebook configuration
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-400 sm:text-base">
                Set up your own Facebook cookie JSON for Marketplace search. This isolates results to your
                account and improves location relevance compared with a shared server cookie.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">Configured</p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {facebookConfigStatus?.configured ? "Yes" : "No"}
                </p>
                <p className="mt-1 text-xs text-zinc-400">Per-account Facebook BYOC</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">Cookies</p>
                <p className="mt-2 text-xl font-semibold text-white">
                  {facebookConfigStatus?.cookie_count ?? "-"}
                </p>
                <p className="mt-1 text-xs text-zinc-400">Loaded from your upload</p>
              </div>
              <div className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">Status</p>
                <p className="mt-2 text-sm font-medium text-zinc-100">
                  {facebookConfigStatus?.status ?? (authLoading ? "Loading..." : "Not configured")}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  {facebookConfigStatus?.feature_enabled === false
                    ? "Facebook source is disabled by server configuration."
                    : "Use Verify after uploading to check that your session is still valid."}
                </p>
              </div>
            </div>
          </div>
        </GlassPanel>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <GlassPanel className="p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="size-4 text-zinc-400" />
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">Setup</p>
            </div>

            <div className="space-y-3">
              {authLoading ? (
                <p className="text-sm text-zinc-400">Checking account...</p>
              ) : !user ? (
                <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
                  <p>Login is required to upload or verify Facebook cookies.</p>
                  <Link href="/login" className="mt-2 inline-flex text-xs underline underline-offset-4">
                    Go to login
                  </Link>
                </div>
              ) : (
                <>
                  {facebookConfigLoading ? (
                    <p className="text-sm text-zinc-400">Loading Facebook setup...</p>
                  ) : facebookConfigStatus?.configured ? (
                    <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-3 text-xs text-emerald-100">
                      <p className="text-sm font-medium">Configured</p>
                      <p className="mt-1">Status: {facebookConfigStatus.status ?? "active"}</p>
                      <p>Cookies: {facebookConfigStatus.cookie_count ?? "-"}</p>
                      {facebookConfigStatus.last_validated_at ? (
                        <p>Last verified: {facebookConfigStatus.last_validated_at}</p>
                      ) : null}
                      {facebookConfigStatus.last_used_at ? (
                        <p>Last used: {facebookConfigStatus.last_used_at}</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-zinc-300">
                      Upload your own Facebook cookie JSON to enable Facebook results for your account.
                    </div>
                  )}

                  {facebookConfigError ? (
                    <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-100">
                      {facebookConfigError}
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <label className="block text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">
                      Upload cookie JSON file
                    </label>
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={onFacebookCookieFileSelected}
                      disabled={facebookUploadBusy}
                      className="block w-full rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-200 file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-1 file:text-xs file:font-medium file:text-black"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">
                      Paste cookie JSON (fallback)
                    </label>
                    <textarea
                      value={facebookCookieJsonText}
                      onChange={(e) => setFacebookCookieJsonText(e.target.value)}
                      placeholder='[{"name":"c_user",...}]'
                      className="min-h-24 w-full rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-white/20 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => void onSaveFacebookCookieJson()}
                      disabled={facebookUploadBusy || authLoading || !user}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {facebookUploadBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => void onVerifyFacebookCookies()}
                      disabled={facebookVerifyBusy || !facebookConfigStatus?.configured || !user}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {facebookVerifyBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      Verify
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteFacebookCookies()}
                      disabled={facebookDeleteBusy || !facebookConfigStatus?.configured || !user}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-300/20 bg-red-400/10 px-3 py-2 text-xs text-red-100 transition hover:border-red-300/30 hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {facebookDeleteBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      Delete
                    </button>
                  </div>
                </>
              )}

              <p className="text-[11px] leading-relaxed text-zinc-500">
                Cookies act like session credentials. Marketly stores them encrypted in Stage 1. Consider
                using a dedicated Facebook account and rotate cookies if needed.
              </p>
            </div>
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="size-4 text-zinc-400" />
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
                How To Export Cookies (Chrome)
              </p>
            </div>

            <ol className="space-y-3 text-sm text-zinc-300">
              <li className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                1. Open `facebook.com` and go to Marketplace. Make sure you are logged in to the account you
                want Marketly to use.
              </li>
              <li className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                2. Open Chrome DevTools (`F12`), then go to the <span className="font-medium text-white">Application</span> tab.
              </li>
              <li className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                3. In the left sidebar, open <span className="font-medium text-white">Cookies</span> and select
                `https://www.facebook.com`.
              </li>
              <li className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                4. Export the full `facebook.com` cookie jar to JSON (not just `c_user` and `xs`), then upload
                it here.
              </li>
              <li className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                5. Click <span className="font-medium text-white">Verify</span> to confirm the session is accepted.
              </li>
            </ol>

            <div className="mt-4 grid gap-3">
              <PlaceholderShot
                title="Marketplace + DevTools"
                caption="Placeholder: screenshot showing Facebook Marketplace with DevTools open."
              />
              <PlaceholderShot
                title="Application > Cookies"
                caption="Placeholder: screenshot of the Application tab with `https://www.facebook.com` selected under Cookies."
              />
              <PlaceholderShot
                title="JSON Export Example"
                caption="Placeholder: screenshot of the cookie export JSON file before upload. Replace sensitive values if showing an example."
              />
            </div>

            <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-relaxed text-amber-100">
              If you upload screenshots later, I can swap these placeholders for real images and tighten the
              instructions around your preferred export method (extension vs manual copy).
            </div>
          </GlassPanel>
        </div>
      </div>
    </main>
  );
}
