"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Dither from "@/components/Dither";
import V0Icon from "@/components/icons/v0-icon";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "../providers";

type AuthMode = "sign_in" | "sign_up";
type PendingAction = "sign_in" | "sign_up" | "google" | "sign_out" | null;
type FeedbackTone = "success" | "error" | "info";
type Feedback = {
  tone: FeedbackTone;
  text: string;
} | null;

function safeNextPath(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/search";
  }

  return next;
}

function GlassPanel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-zinc-950/70 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset] backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

function FeatureRow({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
      <div className="mt-0.5 rounded-xl border border-white/10 bg-white/[0.03] p-2 text-zinc-100">{icon}</div>
      <div>
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">{description}</p>
      </div>
    </div>
  );
}

function StatusBanner({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2 text-sm",
        feedback.tone === "error" && "border-rose-300/20 bg-rose-300/10 text-rose-100",
        feedback.tone === "success" && "border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
        feedback.tone === "info" && "border-blue-300/20 bg-blue-300/10 text-blue-100",
      )}
      role="status"
      aria-live="polite"
    >
      {feedback.text}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="#EA4335"
        d="M12.24 10.285V14.4h5.88c-.255 1.31-1.77 3.84-5.88 3.84-3.54 0-6.42-2.93-6.42-6.54s2.88-6.54 6.42-6.54c2.01 0 3.36.855 4.13 1.59l2.82-2.73C17.37 2.335 15.03 1.2 12.24 1.2 6.27 1.2 1.44 6.03 1.44 12s4.83 10.8 10.8 10.8c6.24 0 10.38-4.38 10.38-10.56 0-.71-.075-1.255-.165-1.955H12.24Z"
      />
      <path fill="#34A853" d="M1.44 6.975l3.39 2.49c.915-2.715 3.48-4.665 7.41-4.665 2.01 0 3.36.855 4.13 1.59l2.82-2.73C17.37 2.335 15.03 1.2 12.24 1.2c-4.14 0-7.65 2.37-9.39 5.775Z" opacity="0" />
      <path fill="#FBBC05" d="M1.44 6.975A10.74 10.74 0 0 0 .6 12c0 1.905.495 3.69 1.365 5.235l3.945-3.045a6.47 6.47 0 0 1-.69-2.19c0-.57.075-1.11.21-1.62L1.44 6.975Z" />
      <path fill="#34A853" d="M12.24 22.8c2.715 0 4.995-.9 6.66-2.445l-3.24-2.655c-.87.615-1.995 1.04-3.42 1.04-4.08 0-5.985-2.76-6.96-4.545l-4.02 3.105C3 20.64 7.305 22.8 12.24 22.8Z" />
      <path fill="#4285F4" d="M22.62 10.29H12.24V14.4h5.88c-.285 1.47-1.14 2.565-2.46 3.45l3.24 2.655c1.89-1.74 2.97-4.305 2.97-8.265 0-.705-.075-1.29-.165-1.95Z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading, signOut: authSignOut } = useAuth();

  const [mode, setMode] = useState<AuthMode>(searchParams.get("mode") === "signup" ? "sign_up" : "sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const nextPath = useMemo(() => safeNextPath(searchParams.get("next")), [searchParams]);
  const isBusy = pendingAction !== null;

  function buildRedirectUrl() {
    if (typeof window === "undefined") return undefined;
    return new URL(nextPath, window.location.origin).toString();
  }

  async function handleEmailAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setFeedback({ tone: "error", text: "Enter your email and password." });
      return;
    }

    if (mode === "sign_in") {
      setPendingAction("sign_in");
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      setPendingAction(null);

      if (error) {
        setFeedback({ tone: "error", text: error.message });
        return;
      }

      setFeedback({ tone: "success", text: "Signed in. Redirecting..." });
      router.push(nextPath);
      router.refresh();
      return;
    }

    setPendingAction("sign_up");
    const emailRedirectTo = buildRedirectUrl();
    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: emailRedirectTo ? { emailRedirectTo } : undefined,
    });
    setPendingAction(null);

    if (error) {
      setFeedback({ tone: "error", text: error.message });
      return;
    }

    if (data.session) {
      setFeedback({ tone: "success", text: "Account created. Redirecting..." });
      router.push(nextPath);
      router.refresh();
      return;
    }

    setMode("sign_in");
    setFeedback({
      tone: "success",
      text: "Account created. Check your email to confirm your address, then sign in.",
    });
  }

  async function handleGoogleAuth() {
    setFeedback(null);
    setPendingAction("google");

    const redirectTo = buildRedirectUrl();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          prompt: "select_account",
          access_type: "offline",
        },
      },
    });

    if (error) {
      setPendingAction(null);
      setFeedback({ tone: "error", text: error.message });
      return;
    }

    setFeedback({ tone: "info", text: "Redirecting to Google..." });
    setPendingAction(null);
  }

  async function handleSignOut() {
    setFeedback(null);
    setPendingAction("sign_out");
    await authSignOut();
    setPendingAction(null);
    setFeedback({ tone: "success", text: "Signed out." });
  }

  return (
    <main className="dark relative min-h-screen overflow-x-hidden bg-black text-white antialiased">
      <div className="pointer-events-none fixed inset-0 -z-20 opacity-20">
        <Dither
          waveColor={[0.30980392156862746, 0.30980392156862746, 0.30980392156862746]}
          disableAnimation={false}
          enableMouseInteraction
          mouseRadius={0.28}
          colorNum={4}
          pixelSize={2}
          waveAmplitude={0.3}
          waveFrequency={3}
          waveSpeed={0.05}
        />
      </div>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_15%_10%,rgba(255,255,255,0.07),transparent_38%),radial-gradient(circle_at_80%_0%,rgba(99,102,241,0.08),transparent_30%),radial-gradient(circle_at_50%_90%,rgba(255,255,255,0.05),transparent_42%)]" />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,0.9)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.9)_1px,transparent_1px)] [background-size:24px_24px]" />

      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/70 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 transition hover:border-white/20 hover:bg-white/[0.04]"
          >
            <span className="font-mono text-sm text-zinc-100">Marketly</span>
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="hidden rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.04] sm:inline-flex"
            >
              Home
            </Link>
            <Link
              href="/search"
              className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.04]"
            >
              Search
            </Link>
            {authLoading ? (
              <span className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-400">
                Loading auth...
              </span>
            ) : user ? (
              <span className="hidden rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-300 md:inline">
                {user.email ?? "Signed in"}
              </span>
            ) : (
              <span className="hidden rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-400 md:inline">
                Sign in or create an account
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-12 pt-6 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
          <GlassPanel className="relative overflow-hidden p-6 sm:p-8">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -left-20 top-0 h-48 w-48 rounded-full bg-white/5 blur-3xl" />
              <div className="absolute right-0 top-8 h-56 w-56 rounded-full bg-blue-400/10 blur-3xl" />
            </div>

            <div className="relative">
              <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
                <Sparkles className="size-3.5 text-zinc-400" />
                Account access
              </p>

              <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">
                Search faster when your account remembers the work.
              </h1>

              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
                Match the same Marketly experience from the landing and search pages with a clean auth flow, saved searches,
                and a Google sign-in option that becomes a two-click signup path once OAuth is enabled in Supabase.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <FeatureRow
                  icon={<ShieldCheck className="size-4" />}
                  title="Supabase-backed auth"
                  description="Email/password today, social login next. Backend JWT usage stays the same."
                />
                <FeatureRow
                  icon={<Sparkles className="size-4" />}
                  title="Two-click signup path"
                  description="Open login, click Google. New users are provisioned automatically through Supabase Auth."
                />
                <FeatureRow
                  icon={<Mail className="size-4" />}
                  title="Email fallback"
                  description="Keep password auth for users who prefer a traditional sign-in flow."
                />
                <FeatureRow
                  icon={<KeyRound className="size-4" />}
                  title="Safe redirect handling"
                  description="Supports internal `next=` redirects after auth without open-redirect behavior."
                />
              </div>

              <div className="mt-6 grid grid-cols-3 gap-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">Step 1</p>
                  <p className="mt-2 text-sm font-medium text-white">Open login</p>
                  <p className="mt-1 text-xs text-zinc-400">Landing or Search CTA</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">Step 2</p>
                  <p className="mt-2 text-sm font-medium text-white">Continue with Google</p>
                  <p className="mt-1 text-xs text-zinc-400">OAuth redirect flow</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">Result</p>
                  <p className="mt-2 text-sm font-medium text-white">Go to search</p>
                  <p className="mt-1 text-xs text-zinc-400">Session is ready</p>
                </div>
              </div>
            </div>
          </GlassPanel>

          <GlassPanel className="relative overflow-hidden p-5 sm:p-6">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-10 top-0 h-28 w-28 rounded-full bg-white/5 blur-2xl" />
              <div className="absolute bottom-0 right-0 h-36 w-36 rounded-full bg-indigo-400/10 blur-3xl" />
            </div>

            <div className="relative space-y-5">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">Sign in to Marketly</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Account access</h2>
                <p className="mt-2 text-sm text-zinc-400">
                  Use Google for the fastest onboarding, or continue with email and password.
                </p>
              </div>

              {authLoading ? (
                <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-zinc-300">
                  <Loader2 className="size-4 animate-spin" />
                  Checking session...
                </div>
              ) : user ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-emerald-200/80">Signed in</p>
                    <p className="mt-2 text-sm font-medium text-emerald-100">{user.email ?? "Marketly account"}</p>
                    <p className="mt-1 text-xs leading-relaxed text-emerald-100/70">
                      Your session is active. Continue to search or sign out to switch accounts.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Link
                      href={nextPath}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200"
                    >
                      Continue
                      <ArrowRight className="size-4" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleSignOut()}
                      disabled={isBusy}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5 text-sm font-medium text-zinc-100 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {pendingAction === "sign_out" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <LogOut className="size-4" />
                      )}
                      Sign out
                    </button>
                  </div>

                  <StatusBanner feedback={feedback} />
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void handleGoogleAuth()}
                    disabled={isBusy}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pendingAction === "google" ? <Loader2 className="size-4 animate-spin" /> : <GoogleMark />}
                    Continue with Google
                  </button>

                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="text-xs uppercase tracking-[0.14em] text-zinc-500">or use email</span>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>

                  <div className="grid grid-cols-2 rounded-xl border border-white/10 bg-black/40 p-1">
                    <button
                      type="button"
                      onClick={() => setMode("sign_in")}
                      disabled={isBusy}
                      className={cn(
                        "rounded-lg px-3 py-2 text-sm transition",
                        mode === "sign_in"
                          ? "bg-white text-black"
                          : "text-zinc-300 hover:bg-white/[0.03] hover:text-white",
                      )}
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("sign_up")}
                      disabled={isBusy}
                      className={cn(
                        "rounded-lg px-3 py-2 text-sm transition",
                        mode === "sign_up"
                          ? "bg-white text-black"
                          : "text-zinc-300 hover:bg-white/[0.03] hover:text-white",
                      )}
                    >
                      Sign up
                    </button>
                  </div>

                  <form onSubmit={handleEmailAuth} className="space-y-4">
                    <div className="space-y-2">
                      <label htmlFor="email" className="block text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">
                        Email
                      </label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                        <input
                          id="email"
                          type="email"
                          autoComplete="email"
                          placeholder="you@domain.com"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.02] py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-zinc-500 focus:border-white/20 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label
                        htmlFor="password"
                        className="block text-xs font-medium uppercase tracking-[0.14em] text-zinc-400"
                      >
                        Password
                      </label>
                      <div className="relative">
                        <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                        <input
                          id="password"
                          type="password"
                          autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
                          placeholder={mode === "sign_in" ? "Your password" : "Create a password"}
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.02] py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-zinc-500 focus:border-white/20 focus:outline-none"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isBusy}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pendingAction === mode ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-4" />
                      )}
                      {mode === "sign_in" ? "Sign in with email" : "Create account"}
                    </button>
                  </form>

                  <StatusBanner feedback={feedback} />

                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                      Google OAuth setup checklist
                    </p>
                    <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-400">
                      <li>Enable Google in Supabase Auth Providers.</li>
                      <li>Add your app URLs to Supabase redirect allow-list (localhost + production).</li>
                      <li>Add Google OAuth client credentials in Supabase and verify callback settings.</li>
                    </ul>
                  </div>
                </>
              )}
            </div>
          </GlassPanel>
        </div>
      </div>
    </main>
  );
}


