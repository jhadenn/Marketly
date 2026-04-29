import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Marketly Facebook Helper Privacy Policy",
  description:
    "Privacy Policy for the Marketly Facebook Session Helper Chrome extension.",
};

const sections = [
  {
    title: "Overview",
    body: [
      "This Privacy Policy applies to the Marketly Facebook Session Helper browser extension and describes how it handles data when used with Marketly.",
      "The extension is used only to connect a user's local Chrome or Edge browser session to that user's Marketly account so Marketly can use the user's own logged-in Facebook Marketplace session for Marketly Facebook search and saved-search alert features.",
    ],
  },
  {
    title: "What The Extension Collects",
    body: [
      "Only after the user gives consent in the extension UI and pairs the extension with their Marketly account does the extension read the required facebook.com authentication cookies from the user's local browser: c_user, xs, fr, datr, and sb.",
      "The extension also stores helper state locally in the browser, including pairing status, helper label, sync status, retry timing, API mode, and related local settings needed to keep the helper connected.",
      "The extension may display local notifications to inform the user when syncing needs attention.",
    ],
  },
  {
    title: "How The Data Is Used",
    body: [
      "Those facebook.com authentication cookies are sent to Marketly's backend only so Marketly can refresh and use the user's own Facebook Marketplace session for that user's Marketly account and related product features.",
      "Local storage data is used only to maintain extension state, recover from disconnects, and support pairing and sync behavior.",
      "Notification data is used only to alert the user when the helper is disconnected, when Facebook needs attention, or when the user needs to reopen the helper.",
    ],
  },
  {
    title: "What The Extension Does Not Do",
    body: [
      "The extension is not a general-purpose Facebook extension.",
      "The extension does not post, message, comment, browse Facebook on the user's behalf, or automate unrelated Facebook activity.",
      "The extension does not collect browsing history, page content, message content, tab content, or content from websites other than the limited facebook.com cookie access described on this page.",
      "The extension does not sell user data.",
      "The extension does not use or transfer user data for purposes unrelated to the extension's single purpose.",
      "The extension does not use or transfer user data to determine creditworthiness or for lending purposes.",
    ],
  },
  {
    title: "Sharing And Transfers",
    body: [
      "Data handled by the extension is transferred to Marketly's backend as part of the product workflow initiated by the user.",
      "Outside of that Marketly product use case, the extension does not sell user data or transfer it to third parties for advertising, profiling, or unrelated analytics purposes.",
    ],
  },
  {
    title: "Storage And Retention",
    body: [
      "The extension stores helper state locally in the browser until the user removes the extension, clears extension storage, or disconnects the helper.",
      "Cookie data synced from the extension is stored by Marketly as part of the user's Facebook connector configuration for only as long as needed to keep the user's Facebook connector active for their Marketly account.",
      "Synced cookie data may be refreshed or replaced during later syncs and is intended to be deleted when the user disconnects, deletes, or reconfigures the Facebook connector or helper.",
    ],
  },
  {
    title: "User Controls",
    body: [
      "Users control whether to pair the extension with Marketly, and consent is required in the extension before pairing or syncing can occur.",
      "Users can disconnect the helper from Marketly and can remove the local helper token from the extension.",
      "Users can also remove the extension from their browser at any time and can delete their saved Facebook connector data from Marketly.",
    ],
  },
  {
    title: "Security",
    body: [
      "The extension is designed to limit its access to the permissions required for pairing, session sync, local state storage, periodic sync checks, and user notifications.",
      "Marketly expects synced Facebook cookie data to be handled as sensitive session data and used only for the Marketly features described on this page.",
    ],
  },
  {
    title: "Changes",
    body: [
      "Marketly may update this Privacy Policy from time to time. When this page changes, the updated version will be posted at this URL.",
    ],
  },
];

export default function FacebookHelperPrivacyPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_38%),linear-gradient(180deg,#050505_0%,#111111_52%,#050505_100%)] px-6 py-16 text-zinc-100 sm:px-10 lg:px-12">
      <div className="mx-auto max-w-4xl">
        <div className="rounded-[2rem] border border-white/10 bg-black/45 p-8 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-10">
          <div className="flex flex-col gap-6 border-b border-white/10 pb-8">
            <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.22em] text-zinc-400">
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                Privacy Policy
              </span>
              <span>Marketly Facebook Session Helper</span>
            </div>
            <div className="space-y-4">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Marketly Facebook Session Helper Privacy Policy
              </h1>
              <p className="max-w-3xl text-sm leading-7 text-zinc-300 sm:text-base">
                Effective date: April 27, 2026. This page describes how the Marketly Facebook
                Session Helper extension handles data when paired with Marketly.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-zinc-300">
              <Link
                href="/facebook-configuration"
                className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 transition hover:border-white/20 hover:bg-white/[0.08]"
              >
                Back to Facebook Configuration
              </Link>
              <Link
                href="/"
                className="inline-flex items-center rounded-full border border-white/10 px-4 py-2 transition hover:border-white/20 hover:bg-white/[0.04]"
              >
                Marketly Home
              </Link>
            </div>
          </div>

          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            <div className="rounded-[1.5rem] border border-emerald-300/15 bg-emerald-400/10 p-5">
              <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-100/80">
                Single Purpose
              </p>
              <p className="mt-3 text-sm leading-6 text-emerald-50">
                Keep a paired user's Facebook Marketplace session synced to Marketly.
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-amber-300/15 bg-amber-400/10 p-5">
              <p className="text-[11px] uppercase tracking-[0.18em] text-amber-100/80">
                Sensitive Data
              </p>
              <p className="mt-3 text-sm leading-6 text-amber-50">
                Reads facebook.com session cookies only after the user explicitly pairs the helper.
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-sky-300/15 bg-sky-400/10 p-5">
              <p className="text-[11px] uppercase tracking-[0.18em] text-sky-100/80">
                User Control
              </p>
              <p className="mt-3 text-sm leading-6 text-sky-50">
                Users can disconnect the helper, remove the extension, or clear the local token at
                any time.
              </p>
            </div>
          </div>

          <div className="mt-10 space-y-8">
            {sections.map((section) => (
              <section
                key={section.title}
                className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-6 sm:p-7"
              >
                <h2 className="text-2xl font-semibold tracking-tight text-white">
                  {section.title}
                </h2>
                <div className="mt-4 space-y-4 text-sm leading-7 text-zinc-300 sm:text-[15px]">
                  {section.body.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <section className="mt-8 rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-6 sm:p-7">
            <h2 className="text-2xl font-semibold tracking-tight text-white">Contact</h2>
            <p className="mt-4 text-sm leading-7 text-zinc-300 sm:text-[15px]">
              Questions about this Privacy Policy or the Marketly Facebook Session Helper can be
              directed to <a className="underline decoration-white/30 underline-offset-4 hover:decoration-white/70" href="mailto:jhadengoy@gmail.com">jhadengoy@gmail.com</a> and any other contact channels published on Marketly.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
