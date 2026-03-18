"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  BellRing,
  Bot,
  Bookmark,
  ChevronDown,
  Loader2,
  LocateFixed,
  LogOut,
  MapPin,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import Dither from "@/components/Dither";
import { cn } from "@/lib/utils";
import { useAuth } from "../providers";

const SOURCE_OPTIONS = ["kijiji", "ebay", "facebook"] as const;
const DEFAULT_SOURCES: SourceOption[] = ["kijiji", "ebay", "facebook"];
const DEFAULT_PAGE_SIZE = 24;
const SORT_OPTIONS = [
  { value: "relevance", label: "Relevance", disabled: false },
  { value: "price_asc", label: "Price: Low -> High", disabled: false },
  { value: "price_desc", label: "Price: High -> Low", disabled: false },
  { value: "newest", label: "Newest (unavailable)", disabled: true },
] as const;

type PreviewListing = {
  title: string;
  price: string;
  location: string;
  source: SourceOption;
  imagePath: string;
  fallbackImagePath: string;
};

// Drop your own files in frontend/public as:
// /preview-listing-1.jpg ... /preview-listing-4.jpg
const PREVIEW_SAMPLE_LISTINGS: PreviewListing[] = [
  {
    title: "Kawaii Chiikawa Plush Toy",
    price: "CAD 15",
    location: "Toronto, ON",
    source: "facebook",
    imagePath: "/example-listing-1.jpg",
    fallbackImagePath: "/example-listing-1.jpg",
  },
  {
    title: "1999 Mazda Miata",
    price: "CAD 6,500",
    location: "North York, ON",
    source: "kijiji",
    imagePath: "/example-listing-2.jpg",
    fallbackImagePath: "/example-listing-2.jpg",
  },
  {
    title: "Nike SB Dunks",
    price: "CAD 150",
    location: "Mississauga, ON",
    source: "ebay",
    imagePath: "/example-listing-3.jpg",
    fallbackImagePath: "/example-listing-2.jpg",
  },
  {
    title: "Comfy Grey Sofa",
    price: "CAD 300",
    location: "Etobicoke, ON",
    source: "facebook",
    imagePath: "/example-listing-4.jpg",
    fallbackImagePath: "/example-listing-1.jpg",
  },
];

type SourceOption = (typeof SOURCE_OPTIONS)[number];
type SortOption = (typeof SORT_OPTIONS)[number]["value"];

type Money = {
  amount: number;
  currency: string;
};

type Valuation = {
  verdict: "underpriced" | "fair" | "overpriced" | "insufficient_data";
  estimated_low?: number | null;
  estimated_high?: number | null;
  median_price?: number | null;
  currency: string;
  confidence: number;
  sample_count: number;
  explanation?: string | null;
};

type Risk = {
  level: "low" | "medium" | "high";
  score: number;
  reasons: string[];
  explanation?: string | null;
};

type Listing = {
  source: string;
  source_listing_id: string;
  title: string;
  price?: Money | null;
  url: string;
  image_urls?: string[];
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  condition?: string | null;
  snippet?: string | null;
  score?: number;
  score_reason?: string | null;
  valuation?: Valuation | null;
  risk?: Risk | null;
};

type SearchResponse = {
  query: string;
  sources: string[];
  count: number;
  results: Listing[];
  next_offset?: number | null;
  total?: number | null;
  source_errors?: Record<string, SourceErrorEntry> | null;
};

type SourceErrorEntry = {
  code: string;
  message: string;
  retryable?: boolean;
};

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

type SavedSearch = {
  id: number;
  query: string;
  sources: string[];
  alerts_enabled: boolean;
  last_alert_checked_at?: string | null;
  last_alert_notified_at?: string | null;
  created_at: string;
};

type NotificationItem = {
  listing_key: string;
  source: string;
  source_listing_id: string;
  title: string;
  url: string;
  price?: Money | null;
  location?: string | null;
  match_confidence: number;
  why_matched: string[];
  valuation?: Valuation | null;
  risk?: Risk | null;
};

type SavedSearchNotification = {
  id: number;
  saved_search_id: number;
  saved_search_query: string;
  summary: string;
  created_at: string;
  read_at?: string | null;
  items: NotificationItem[];
};

type CopilotShortlistItem = {
  listing_key: string;
  title: string;
  reason: string;
};

type CopilotResponse = {
  available: boolean;
  answer: string;
  shortlist: CopilotShortlistItem[];
  seller_questions: string[];
  red_flags: string[];
  error_message?: string | null;
};

type SavedBatchPaginationEntry = {
  id: number;
  query: string;
  sources: SourceOption[];
  nextOffset: number | null;
};

type SavedBatchPaginationState = {
  selectedSort: SortOption;
  selectedLimit: number;
  entries: SavedBatchPaginationEntry[];
};

type ResultMode = "single" | "saved_batch";
type Coordinates = { latitude: number; longitude: number };
type SavedSearchResultBucket = { items: Listing[] };
type InterleavedSavedSearchBucketResult = {
  orderedItems: Listing[];
  seenKeys: Set<string>;
  nextLaneStart: number;
};

function isSourceOption(value: string): value is SourceOption {
  return SOURCE_OPTIONS.includes(value as SourceOption);
}

function formatPrice(price?: Money | null) {
  if (!price) return "-";
  return `${price.currency} ${price.amount}`;
}

function formatMoneyCompact(amount?: number | null, currency = "CAD") {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  return `${currency} ${Math.round(amount)}`;
}

function getListingKey(item: Listing): string {
  return `${item.source}:${item.source_listing_id || item.url}`;
}

function sortListingsLocal(listings: Listing[], sort: SortOption): Listing[] {
  if (sort === "relevance") {
    return [...listings];
  }

  const indexed = listings.map((item, index) => ({ item, index }));

  if (sort === "price_asc") {
    indexed.sort((a, b) => {
      const aMissing = a.item.price == null;
      const bMissing = b.item.price == null;
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      const aAmount = a.item.price?.amount ?? Number.POSITIVE_INFINITY;
      const bAmount = b.item.price?.amount ?? Number.POSITIVE_INFINITY;
      if (aAmount !== bAmount) return aAmount - bAmount;
      return a.index - b.index;
    });
    return indexed.map((entry) => entry.item);
  }

  if (sort === "price_desc") {
    indexed.sort((a, b) => {
      const aMissing = a.item.price == null;
      const bMissing = b.item.price == null;
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      const aAmount = a.item.price?.amount ?? Number.NEGATIVE_INFINITY;
      const bAmount = b.item.price?.amount ?? Number.NEGATIVE_INFINITY;
      if (aAmount !== bAmount) return bAmount - aAmount;
      return a.index - b.index;
    });
    return indexed.map((entry) => entry.item);
  }

  return [...listings];
}

function sortDebounceMs(resultCount: number): number {
  if (resultCount >= 1000) return 220;
  if (resultCount >= 200) return 120;
  return 0;
}

function computeSavedBatchSeed(savedSearches: Pick<SavedSearch, "id" | "query">[]): number {
  if (savedSearches.length <= 1) return 0;

  let hash = 0;
  for (const entry of savedSearches) {
    const token = `${entry.id}:${entry.query}`;
    for (let index = 0; index < token.length; index += 1) {
      hash = ((hash * 31) + token.charCodeAt(index)) >>> 0;
    }
  }

  return hash % savedSearches.length;
}

function interleaveSavedSearchBuckets({
  buckets,
  laneStart,
  initialSeenKeys,
}: {
  buckets: SavedSearchResultBucket[];
  laneStart: number;
  initialSeenKeys: Set<string>;
}): InterleavedSavedSearchBucketResult {
  if (buckets.length === 0) {
    return {
      orderedItems: [],
      seenKeys: new Set(initialSeenKeys),
      nextLaneStart: 0,
    };
  }

  const normalizedLaneStart = ((laneStart % buckets.length) + buckets.length) % buckets.length;
  const laneOrder = Array.from(
    { length: buckets.length },
    (_, index) => (normalizedLaneStart + index) % buckets.length,
  );
  const positions = buckets.map(() => 0);
  const seenKeys = new Set(initialSeenKeys);
  const orderedItems: Listing[] = [];

  while (true) {
    let appendedInCycle = false;

    for (const laneIndex of laneOrder) {
      const laneItems = buckets[laneIndex]?.items ?? [];
      while (positions[laneIndex] < laneItems.length) {
        const item = laneItems[positions[laneIndex]];
        positions[laneIndex] += 1;
        const listingKey = getListingKey(item);
        if (seenKeys.has(listingKey)) continue;
        seenKeys.add(listingKey);
        orderedItems.push(item);
        appendedInCycle = true;
        break;
      }
    }

    if (!appendedInCycle) {
      break;
    }
  }

  return {
    orderedItems,
    seenKeys,
    nextLaneStart: (normalizedLaneStart + 1) % buckets.length,
  };
}

function formatSourceLabel(source: string) {
  if (!source) return "";
  return source
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTimestamp(value?: string | null) {
  if (!value) return "Just now";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function haversineMiles(a: Coordinates, b: Coordinates) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const latDelta = toRadians(b.latitude - a.latitude);
  const lonDelta = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const sinLat = Math.sin(latDelta / 2);
  const sinLon = Math.sin(lonDelta / 2);
  const value =
    sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  const arc = 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  return earthRadiusMiles * arc;
}

type SearchPageViewProps = {
  authLoading: boolean;
  user: { email?: string | null } | null;
  signOut: () => Promise<void> | void;
  q: string;
  setQ: React.Dispatch<React.SetStateAction<string>>;
  sources: SourceOption[];
  sortBy: SortOption;
  sortApplying: boolean;
  onChangeSort: (nextSort: SortOption) => Promise<void>;
  toggleSource: (source: SourceOption) => void;
  searchLoading: boolean;
  loadingMore: boolean;
  onSearch: (e: React.FormEvent) => Promise<void>;
  onSaveCurrentSearch: () => Promise<void>;
  limit: number;
  locationFilterText: string;
  setLocationFilterText: React.Dispatch<React.SetStateAction<string>>;
  onUseMyLocation: () => void;
  onClearMyLocation: () => void;
  locatingDevice: boolean;
  deviceCoords: Coordinates | null;
  locationFilterError: string | null;
  travelRangeMilesInput: string;
  setTravelRangeMilesInput: React.Dispatch<React.SetStateAction<string>>;
  hideUnknownDistance: boolean;
  setHideUnknownDistance: React.Dispatch<React.SetStateAction<boolean>>;
  distanceFilterPendingLocation: boolean;
  distanceFilterActive: boolean;
  error: string | null;
  sourceErrors: Record<string, SourceErrorEntry>;
  hasSourceErrorEntries: boolean;
  hasSearched: boolean;
  results: Listing[];
  filteredResults: Listing[];
  resultMode: ResultMode | null;
  total: number | null;
  totalResultsCount: number;
  hasActiveClientFilters: boolean;
  filteredOutCount: number;
  summarySources: SourceOption[];
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  hasMore: boolean;
  saved: SavedSearch[];
  savedLoading: boolean;
  savedError: string | null;
  notifications: SavedSearchNotification[];
  notificationsLoading: boolean;
  notificationsError: string | null;
  activeSavedSearchId: number | null;
  fetchSavedSearches: () => Promise<SavedSearch[] | null>;
  fetchNotifications: () => Promise<SavedSearchNotification[] | null>;
  onMarkNotificationRead: (id: number) => Promise<void>;
  runAllSavedSearches: (savedSearches: SavedSearch[]) => Promise<void>;
  onRunSavedSearch: (id: number) => Promise<void>;
  onDeleteSavedSearch: (id: number) => Promise<void>;
  onToggleSavedSearchAlerts: (entry: SavedSearch) => Promise<void>;
  openEdit: (entry: SavedSearch) => void;
  editing: SavedSearch | null;
  closeEdit: () => void;
  editError: string | null;
  editSaving: boolean;
  editQuery: string;
  setEditQuery: React.Dispatch<React.SetStateAction<string>>;
  editSources: SourceOption[];
  toggleEditSource: (source: SourceOption) => void;
  editAlertsEnabled: boolean;
  setEditAlertsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  onSaveEdit: () => Promise<void>;
  facebookConfigStatus: FacebookConnectorStatus | null;
  facebookConfigLoading: boolean;
  facebookConfigError: string | null;
  facebookUploadBusy: boolean;
  facebookVerifyBusy: boolean;
  facebookDeleteBusy: boolean;
  facebookCookieJsonText: string;
  setFacebookCookieJsonText: React.Dispatch<React.SetStateAction<string>>;
  onSaveFacebookCookieJson: () => Promise<void>;
  onVerifyFacebookCookies: () => Promise<void>;
  onDeleteFacebookCookies: () => Promise<void>;
  onFacebookCookieFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
  activeQuery: string;
  copilotOpen: boolean;
  toggleCopilotOpen: () => void;
  copilotQuestion: string;
  setCopilotQuestion: React.Dispatch<React.SetStateAction<string>>;
  copilotLoading: boolean;
  copilotError: string | null;
  copilotResponse: CopilotResponse | null;
  onAskCopilot: (questionOverride?: string) => Promise<void>;
};

function GlassPanel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
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

type SearchControlsRailProps = Pick<
  SearchPageViewProps,
  | "q"
  | "setQ"
  | "onSearch"
  | "onSaveCurrentSearch"
  | "searchLoading"
  | "loadingMore"
  | "sources"
  | "toggleSource"
  | "sortBy"
  | "sortApplying"
  | "onChangeSort"
  | "locationFilterText"
  | "setLocationFilterText"
  | "onUseMyLocation"
  | "onClearMyLocation"
  | "locatingDevice"
  | "deviceCoords"
  | "locationFilterError"
  | "travelRangeMilesInput"
  | "setTravelRangeMilesInput"
  | "hideUnknownDistance"
  | "setHideUnknownDistance"
  | "distanceFilterPendingLocation"
  | "distanceFilterActive"
  | "authLoading"
  | "user"
  | "facebookConfigStatus"
  | "facebookConfigLoading"
  | "facebookConfigError"
  | "facebookUploadBusy"
  | "facebookVerifyBusy"
  | "facebookDeleteBusy"
  | "facebookCookieJsonText"
  | "setFacebookCookieJsonText"
  | "onSaveFacebookCookieJson"
  | "onVerifyFacebookCookies"
  | "onDeleteFacebookCookies"
  | "onFacebookCookieFileSelected"
>;

type SavedSearchRailProps = Pick<
  SearchPageViewProps,
  | "authLoading"
  | "user"
  | "saved"
  | "savedLoading"
  | "savedError"
  | "activeSavedSearchId"
  | "searchLoading"
  | "loadingMore"
  | "fetchSavedSearches"
  | "runAllSavedSearches"
  | "onRunSavedSearch"
  | "onDeleteSavedSearch"
  | "onToggleSavedSearchAlerts"
  | "openEdit"
>;

type AlertsRailProps = Pick<
  SearchPageViewProps,
  | "authLoading"
  | "user"
  | "notifications"
  | "notificationsLoading"
  | "notificationsError"
  | "fetchNotifications"
  | "onMarkNotificationRead"
>;

type ResultsPanelProps = Pick<
  SearchPageViewProps,
  | "authLoading"
  | "user"
  | "searchLoading"
  | "results"
  | "hasSearched"
  | "resultMode"
  | "total"
  | "totalResultsCount"
  | "filteredResults"
  | "hasActiveClientFilters"
  | "filteredOutCount"
  | "summarySources"
  | "sourceErrors"
  | "hasSourceErrorEntries"
  | "error"
  | "deviceCoords"
  | "sentinelRef"
  | "loadingMore"
  | "hasMore"
  | "activeQuery"
  | "copilotOpen"
  | "toggleCopilotOpen"
  | "copilotQuestion"
  | "setCopilotQuestion"
  | "copilotLoading"
  | "copilotError"
  | "copilotResponse"
  | "onAskCopilot"
>;

function SearchPageView(props: SearchPageViewProps) {
  const heroQuery = props.q.trim();
  const heroTitle =
    heroQuery || (props.hasSearched ? "Unified results" : "All marketplaces. One search.");
  const showLiveHeroCopy = heroQuery.length > 0 || props.hasSearched;

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
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_15%_10%,rgba(255,255,255,0.07),transparent_38%),radial-gradient(circle_at_80%_0%,rgba(99,102,241,0.08),transparent_30%),radial-gradient(circle_at_50%_90%,rgba(255,255,255,0.05),transparent_42%)]" />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,0.9)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.9)_1px,transparent_1px)] [background-size:24px_24px]" />

      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/70 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 transition hover:border-white/20 hover:bg-white/[0.04]"
            >
              <span className="font-mono text-sm text-zinc-100">Marketly</span>
            </Link>
            <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-300 md:inline-flex">
              <Sparkles className="size-3.5 text-zinc-400" />
              Marketplace Search
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="hidden rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.04] sm:inline-flex"
            >
              Home
            </Link>

            {props.authLoading ? (
              <span className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-400">
                Loading auth...
              </span>
            ) : props.user ? (
              <details className="relative">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden">
                  <span className="hidden max-w-[220px] truncate sm:inline">
                    {props.user.email ?? "Signed in"}
                  </span>
                  <span className="sm:hidden">Account</span>
                  <ChevronDown className="size-3.5 text-zinc-400" />
                </summary>
                <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 p-1 shadow-2xl backdrop-blur-xl">
                  <Link
                    href="/facebook-configuration"
                    className="block rounded-xl px-3 py-2 text-sm text-zinc-200 transition hover:bg-white/[0.05]"
                  >
                    Facebook configuration
                  </Link>
                  <button
                    type="button"
                    onClick={() => void props.signOut()}
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

      <div className="mx-auto max-w-[1500px] px-4 pb-12 pt-6 sm:px-6 lg:px-8">
        <GlassPanel className="relative mb-6 overflow-hidden p-5 sm:p-6">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 top-0 h-48 w-48 rounded-full bg-white/5 blur-3xl" />
            <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-blue-400/10 blur-3xl" />
          </div>

          <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
                <Sparkles className="size-3.5 text-zinc-400" />
                Search all marketplaces in one feed
              </p>
              <h1 className="mt-4 max-w-4xl text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">
                {heroTitle}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-400 sm:text-base">
                {showLiveHeroCopy
                  ? "Compare live listings across Kijiji, eBay, and Facebook Marketplace in a single feed with image-first tiles inspired by Facebook Marketplace."
                  : "Run a search, choose sources, and browse a unified marketplace grid with saved searches and infinite scroll."}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {(props.summarySources.length > 0 ? props.summarySources : props.sources).map((source) => (
                  <SourceChip key={`hero-source-${source}`} source={source} compact />
                ))}
                <span className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 text-xs text-zinc-300">
                  {props.hasSearched ? `${props.filteredResults.length} visible` : `${props.limit} per page`}
                </span>
                {props.hasActiveClientFilters ? (
                  <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">
                    Location filters active
                  </span>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Results" value={String(props.hasSearched ? props.totalResultsCount : 0)} sub={props.hasSearched ? "Loaded/reported total" : "Waiting for search"} />
              <StatTile
                label="Mode"
                value={props.hasSearched ? "Live Query" : "Idle"}
                sub={props.hasMore ? "Infinite scroll enabled" : "No more pages yet"}
              />
              <StatTile
                label="Showing"
                value={String(props.filteredResults.length)}
                sub={props.hasActiveClientFilters ? `${props.filteredOutCount} filtered out` : "No client filters"}
              />
              <StatTile label="Sources" value={String((props.summarySources.length > 0 ? props.summarySources : props.sources).length)} sub="Selected" />
            </div>
          </div>
        </GlassPanel>

        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            <SearchControlsRail {...props} />
            <AlertsRail {...props} />
            <SavedSearchRail {...props} />
          </aside>

          <ResultsPanel {...props} />
        </div>
      </div>

      <EditSavedSearchModal {...props} />
    </main>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
      <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">{value}</p>
      <p className="mt-1 text-xs text-zinc-400">{sub}</p>
    </div>
  );
}

function SearchControlsRail(props: SearchControlsRailProps) {
  return (
    <>
      <GlassPanel className="p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <Search className="size-4 text-zinc-400" />
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">Search</p>
        </div>

        <form onSubmit={props.onSearch} className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">
              Query
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
              <input
                className="w-full rounded-xl border border-white/10 bg-white/[0.02] py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-zinc-500 focus:border-white/20 focus:outline-none"
                value={props.q}
                onChange={(e) => props.setQ(e.target.value)}
                placeholder="iphone, macbook, snowboard..."
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="submit"
              disabled={props.searchLoading || props.loadingMore || !props.q.trim() || props.sources.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {props.searchLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              {props.searchLoading ? "Searching..." : "Search"}
            </button>

            <button
              type="button"
              onClick={() => void props.onSaveCurrentSearch()}
              disabled={!props.q.trim() || props.sources.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5 text-sm font-medium text-zinc-100 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Bookmark className="size-4" />
              Save search
            </button>
          </div>

          {(props.searchLoading || props.loadingMore) && (
            <div className="flex items-center justify-end gap-1 text-xs text-zinc-400">
              <Loader2 className="size-3.5 animate-spin" />
              Live query
            </div>
          )}
        </form>
      </GlassPanel>

      <GlassPanel className="p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-zinc-400" />
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">Filters</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">
              Sources
            </label>
            <div className="flex flex-wrap gap-2">
              {SOURCE_OPTIONS.map((source) => (
                <SourceChip
                  key={`source-toggle-${source}`}
                  source={source}
                  selected={props.sources.includes(source)}
                  onClick={() => props.toggleSource(source)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">
              Sort
            </label>
            <select
              className="w-full rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm text-zinc-100 focus:border-white/20 focus:outline-none"
              value={props.sortBy}
              onChange={(e) => void props.onChangeSort(e.target.value as SortOption)}
            >
              {SORT_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="bg-black text-white"
                >
                  {option.label}
                </option>
              ))}
            </select>
            {props.sortApplying ? (
              <p className="inline-flex items-center gap-1 text-xs text-zinc-500">
                <Loader2 className="size-3 animate-spin" />
                Sorting...
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">
              Location text filter
            </label>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
              <input
                className="w-full rounded-xl border border-white/10 bg-white/[0.02] py-2.5 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-white/20 focus:outline-none"
                value={props.locationFilterText}
                onChange={(e) => props.setLocationFilterText(e.target.value)}
                placeholder="City, state, neighborhood..."
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={props.onUseMyLocation}
              disabled={props.locatingDevice}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm text-zinc-100 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {props.locatingDevice ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LocateFixed className="size-4" />
              )}
              {props.locatingDevice ? "Locating..." : "Use GPS"}
            </button>

            <button
              type="button"
              onClick={props.onClearMyLocation}
              disabled={!props.deviceCoords}
              className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear GPS
            </button>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">
              Range (miles)
            </label>
            <input
              className="w-full rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-white/20 focus:outline-none"
              type="number"
              min={1}
              max={500}
              value={props.travelRangeMilesInput}
              onChange={(e) => props.setTravelRangeMilesInput(e.target.value)}
              placeholder="Off"
            />
          </div>

          <label className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-white/20 bg-black"
              checked={props.hideUnknownDistance}
              onChange={(e) => props.setHideUnknownDistance(e.target.checked)}
            />
            <span>Hide listings without distance data when range filtering is enabled.</span>
          </label>

          {props.sources.length === 0 ? (
            <p className="text-xs text-red-300">Select at least one source to search.</p>
          ) : null}
          {props.deviceCoords ? (
            <p className="text-xs text-zinc-500">
              GPS ready: {props.deviceCoords.latitude.toFixed(3)}, {props.deviceCoords.longitude.toFixed(3)}
            </p>
          ) : null}
          {props.locationFilterError ? (
            <p className="text-xs text-red-300">{props.locationFilterError}</p>
          ) : null}
          {props.distanceFilterPendingLocation ? (
            <p className="text-xs text-amber-200">
              Range is set, but GPS is not enabled yet. Tap &quot;Use GPS&quot; to apply distance
              filtering.
            </p>
          ) : null}
          {props.distanceFilterActive ? (
            <p className="text-xs text-zinc-400">
              Distance filtering is active. Facebook listings usually have the best coordinate support.
            </p>
          ) : null}
        </div>
      </GlassPanel>

    </>
  );
}

function SavedSearchRail(props: SavedSearchRailProps) {
  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bookmark className="size-4 text-zinc-400" />
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
            Saved Searches
          </p>
        </div>

        <div className="flex items-center gap-2">
          {props.user && props.saved.length > 1 ? (
            <button
              type="button"
              onClick={() => void props.runAllSavedSearches(props.saved)}
              disabled={props.searchLoading || props.loadingMore}
              className="rounded-full border border-white/10 bg-white/[0.02] px-2.5 py-1 text-xs text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Run all
            </button>
          ) : null}

          <button
            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.02] px-2.5 py-1 text-xs text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void props.fetchSavedSearches()}
            disabled={props.savedLoading}
            type="button"
          >
            <RefreshCw className={cn("size-3.5", props.savedLoading && "animate-spin")} />
            {props.savedLoading ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>

      {props.savedError ? (
        <div className="mb-3 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">
          {props.savedError}
        </div>
      ) : null}

      {props.saved.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4">
          <p className="text-sm text-zinc-300">
            {props.authLoading
              ? "Checking your account..."
              : props.user
                ? "No saved searches yet."
                : "Log in to view and run saved searches."}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Saved searches can auto-load a multi-query feed and feed the alert digest.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {props.saved.map((entry) => (
            <li
              key={entry.id}
              className={cn(
                "rounded-xl border border-white/10 bg-white/[0.02] p-3 transition",
                props.activeSavedSearchId === entry.id && "border-white/20 bg-white/[0.05]",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="line-clamp-1 text-sm font-medium text-zinc-100">{entry.query}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                    <span>Saved</span>
                    <span
                      className={cn(
                        "rounded-full border px-1.5 py-0.5",
                        entry.alerts_enabled
                          ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                          : "border-white/10 bg-white/[0.02] text-zinc-400",
                      )}
                    >
                      {entry.alerts_enabled ? "Alerts on" : "Alerts off"}
                    </span>
                  </div>
                </div>
                {props.activeSavedSearchId === entry.id ? (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-300">
                    Active
                  </span>
                ) : null}
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {entry.sources.map((source) => (
                  <SourceChip key={`saved-source-${entry.id}-${source}`} source={source} compact />
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black transition hover:bg-zinc-200"
                  type="button"
                  onClick={() => void props.onRunSavedSearch(entry.id)}
                >
                  Run
                </button>
                <button
                  className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.05]"
                  type="button"
                  onClick={() => props.openEdit(entry)}
                >
                  Edit
                </button>
                <button
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs transition",
                    entry.alerts_enabled
                      ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100 hover:border-emerald-300/40"
                      : "border-white/10 bg-white/[0.02] text-zinc-200 hover:border-white/20 hover:bg-white/[0.05]",
                  )}
                  type="button"
                  onClick={() => void props.onToggleSavedSearchAlerts(entry)}
                >
                  {entry.alerts_enabled ? "Disable alerts" : "Enable alerts"}
                </button>
                <button
                  className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-200 transition hover:border-red-300/30 hover:bg-red-400/10 hover:text-red-100"
                  type="button"
                  onClick={() => void props.onDeleteSavedSearch(entry.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}

function AlertsRail(props: AlertsRailProps) {
  const unreadCount = props.notifications.filter((entry) => !entry.read_at).length;

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BellRing className="size-4 text-zinc-400" />
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
            Alerts
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-full border border-white/10 bg-white/[0.02] px-2.5 py-1 text-[11px] text-zinc-300">
            {unreadCount} unread
          </span>
          <button
            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.02] px-2.5 py-1 text-xs text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void props.fetchNotifications()}
            disabled={props.notificationsLoading}
            type="button"
          >
            <RefreshCw className={cn("size-3.5", props.notificationsLoading && "animate-spin")} />
            {props.notificationsLoading ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>

      {props.notificationsError ? (
        <div className="mb-3 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">
          {props.notificationsError}
        </div>
      ) : null}

      {!props.user ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4">
          <p className="text-sm text-zinc-300">
            {props.authLoading ? "Checking your account..." : "Log in to receive alert digests."}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Daily digests only include new high-confidence matches from alert-enabled saved searches.
          </p>
        </div>
      ) : props.notifications.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4">
          <p className="text-sm text-zinc-300">No alert digests yet.</p>
          <p className="mt-1 text-xs text-zinc-500">
            Enable alerts on a saved search and the next digest will show up here.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {props.notifications.map((notification) => (
            <li
              key={notification.id}
              className={cn(
                "rounded-xl border p-3 transition",
                notification.read_at
                  ? "border-white/10 bg-white/[0.02]"
                  : "border-emerald-300/20 bg-emerald-400/[0.06]",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-medium text-zinc-100">
                    {notification.summary}
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {notification.saved_search_query} | {formatTimestamp(notification.created_at)}
                  </p>
                </div>
                {!notification.read_at ? (
                  <button
                    type="button"
                    className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-emerald-100 transition hover:border-emerald-300/40"
                    onClick={() => void props.onMarkNotificationRead(notification.id)}
                  >
                    Read
                  </button>
                ) : (
                  <span className="rounded-full border border-white/10 bg-white/[0.02] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-zinc-400">
                    Read
                  </span>
                )}
              </div>

              <ul className="mt-3 space-y-1.5">
                {notification.items.slice(0, 3).map((item) => (
                  <li key={`${notification.id}-${item.listing_key}`}>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-lg border border-white/10 bg-black/20 px-3 py-2 transition hover:border-white/20 hover:bg-white/[0.03]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="line-clamp-1 text-xs font-medium text-zinc-100">{item.title}</p>
                          <p className="mt-1 text-[11px] text-zinc-500">
                            {formatSourceLabel(item.source)} | {Math.round(item.match_confidence * 100)}% match
                          </p>
                        </div>
                        <span className="text-[11px] text-zinc-300">{formatPrice(item.price)}</span>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}

function ResultsPanel({
  searchLoading,
  results,
  hasSearched,
  filteredResults,
  hasActiveClientFilters,
  sourceErrors,
  hasSourceErrorEntries,
  error,
  deviceCoords,
  sentinelRef,
  loadingMore,
  hasMore,
  activeQuery,
  copilotOpen,
  toggleCopilotOpen,
  copilotQuestion,
  setCopilotQuestion,
  copilotLoading,
  copilotError,
  copilotResponse,
  onAskCopilot,
}: ResultsPanelProps) {
  return (
    <section className="space-y-4">
      <CopilotPanel
        activeQuery={activeQuery}
        filteredResults={filteredResults}
        copilotOpen={copilotOpen}
        toggleCopilotOpen={toggleCopilotOpen}
        copilotQuestion={copilotQuestion}
        setCopilotQuestion={setCopilotQuestion}
        copilotLoading={copilotLoading}
        copilotError={copilotError}
        copilotResponse={copilotResponse}
        onAskCopilot={onAskCopilot}
      />

      {error ? (
        <GlassPanel className="border-red-400/20 bg-red-500/10 p-4 text-red-100">
          <p className="text-sm font-medium">Search error</p>
          <p className="mt-1 text-sm text-red-100/90">{error}</p>
        </GlassPanel>
      ) : null}

      {hasSourceErrorEntries ? (
        <GlassPanel className="border-amber-300/20 bg-amber-300/10 p-4 text-amber-50">
          <p className="text-sm font-medium">One or more sources are unavailable.</p>
          {sourceErrors.facebook ? (
            <p className="mt-1 text-xs text-amber-100/90">
              Facebook source unavailable: {sourceErrors.facebook.message}
              {sourceErrors.facebook.code === "AUTH_REQUIRED"
                ? " Log in and open Facebook configuration from the account menu."
                : null}
              {sourceErrors.facebook.code === "BYOC_REQUIRED"
                ? " Open Facebook configuration from the account menu and upload your cookie JSON."
                : null}
            </p>
          ) : null}
          <ul className="mt-2 space-y-1 text-xs text-amber-100/80">
            {Object.entries(sourceErrors).map(([source, sourceError]) => (
              <li key={source}>
                {source}: {sourceError.code} - {sourceError.message}
              </li>
            ))}
          </ul>
        </GlassPanel>
      ) : null}

      {searchLoading && results.length === 0 ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <li
              key={`skeleton-${index}`}
              className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80"
            >
              <div className="aspect-[5/4] animate-pulse bg-zinc-900/80" />
              <div className="space-y-2 p-3.5">
                <div className="h-4 w-24 animate-pulse rounded bg-zinc-800" />
                <div className="h-3 w-full animate-pulse rounded bg-zinc-900" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-900" />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {!searchLoading && !hasSearched ? (
        <GlassPanel className="overflow-hidden border-dashed p-5 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">Preview</p>
              <h3 className="mt-2 max-w-2xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Start your search to see live results from all marketplaces in one feed.
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-400">
                Listings will appear here. Use the search box and filters to find exactly what you want across Kijiji, eBay, and Facebook Marketplace. Save searches you want to check again later, and run them with one click from the sidebar.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {PREVIEW_SAMPLE_LISTINGS.map((listing, index) => (
                <PreviewListingCard key={`preview-card-${index}`} listing={listing} />
              ))}
            </div>
          </div>
        </GlassPanel>
      ) : null}

      {hasSearched && !searchLoading ? (
        <>
          {filteredResults.length === 0 ? (
            <GlassPanel className="p-5 text-sm text-zinc-300">
              {results.length > 0 && hasActiveClientFilters
                ? "No listings match your location filters."
                : "No results found for this search."}
            </GlassPanel>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredResults.map((item) => {
                const cardKey = `${item.source}:${item.source_listing_id || item.url}`;
                return (
                  <MarketplaceResultCard key={cardKey} item={item} deviceCoords={deviceCoords} />
                );
              })}
            </ul>
          )}

          {loadingMore ? (
            <GlassPanel className="flex items-center justify-center gap-2 p-3 text-sm text-zinc-300">
              <Loader2 className="size-4 animate-spin" />
              Loading more listings...
            </GlassPanel>
          ) : null}

          {!hasMore && results.length > 0 ? (
            <p className="text-center text-xs text-zinc-500">No more results.</p>
          ) : null}

          <div ref={sentinelRef} className="h-2" />
        </>
      ) : null}
    </section>
  );
}

function PreviewListingCard({ listing }: { listing: PreviewListing }) {
  const [useFallbackImage, setUseFallbackImage] = useState(false);
  const imageSrc = useFallbackImage ? listing.fallbackImagePath : listing.imagePath;

  return (
    <article className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80">
      <div className="relative aspect-[5/4] bg-zinc-900">
        <Image
          src={imageSrc}
          alt={listing.title}
          fill
          sizes="(max-width: 1024px) 50vw, 220px"
          className="object-cover"
          onError={() => {
            if (!useFallbackImage) {
              setUseFallbackImage(true);
            }
          }}
        />
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
          <MarketplaceSourceBadge source={listing.source} />
        </div>
      </div>
      <div className="space-y-1.5 p-3">
        <p className="line-clamp-2 text-sm font-medium text-zinc-100">{listing.title}</p>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-zinc-200">{listing.price}</p>
          <p className="line-clamp-1 text-[11px] text-zinc-500">{listing.location}</p>
        </div>
      </div>
    </article>
  );
}

function EditSavedSearchModal(
  props: Pick<
    SearchPageViewProps,
    | "editing"
    | "closeEdit"
    | "editSaving"
    | "editError"
    | "editQuery"
    | "setEditQuery"
    | "editSources"
    | "toggleEditSource"
    | "editAlertsEnabled"
    | "setEditAlertsEnabled"
    | "onSaveEdit"
  >,
) {
  if (!props.editing) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 p-5 shadow-2xl">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-blue-400/10 blur-3xl" />
          <div className="absolute -left-10 bottom-0 h-28 w-28 rounded-full bg-white/5 blur-2xl" />
        </div>

        <div className="relative space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">
                Saved Search
              </p>
              <h3 className="mt-1 text-lg font-semibold tracking-tight text-white">
                Edit saved search
              </h3>
              <p className="mt-1 text-xs text-zinc-400">Update the query and selected sources.</p>
            </div>
            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 text-xs text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.05]"
              onClick={props.closeEdit}
              disabled={props.editSaving}
            >
              Close
            </button>
          </div>

          {props.editError ? (
            <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">
              {props.editError}
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="block text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">
              Query
            </label>
            <input
              className="w-full rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-white/20 focus:outline-none"
              value={props.editQuery}
              onChange={(e) => props.setEditQuery(e.target.value)}
              placeholder="e.g., iphone, macbook, snowboard"
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">Sources</p>
            <div className="flex flex-wrap gap-2">
              {SOURCE_OPTIONS.map((source) => (
                <SourceChip
                  key={`edit-source-${source}`}
                  source={source}
                  selected={props.editSources.includes(source)}
                  onClick={() => props.toggleEditSource(source)}
                />
              ))}
            </div>
            {props.editSources.length === 0 ? (
              <p className="text-xs text-red-300">Select at least one source.</p>
            ) : null}
          </div>

          <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-zinc-100">AI alerts</p>
              <p className="text-xs text-zinc-500">Include this search in the daily alert digest.</p>
            </div>
            <button
              type="button"
              onClick={() => props.setEditAlertsEnabled((prev) => !prev)}
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1 text-xs transition",
                props.editAlertsEnabled
                  ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
                  : "border-white/10 bg-white/[0.02] text-zinc-300",
              )}
            >
              {props.editAlertsEnabled ? "Enabled" : "Disabled"}
            </button>
          </label>

          <div className="flex items-center justify-end gap-2">
            <button
              className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2 text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={props.closeEdit}
              disabled={props.editSaving}
            >
              Cancel
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={() => void props.onSaveEdit()}
              disabled={props.editSaving || !props.editQuery.trim() || props.editSources.length === 0}
            >
              {props.editSaving ? <Loader2 className="size-4 animate-spin" /> : null}
              {props.editSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getSourceChipTone(source: string) {
  const normalized = source.toLowerCase();

  if (normalized.includes("facebook")) {
    return {
      border: "border-blue-300/25",
      bg: "bg-blue-400/10",
      text: "text-blue-100",
      dot: "bg-blue-300",
      hover: "hover:border-blue-300/45 hover:bg-blue-400/15",
    };
  }

  if (normalized.includes("ebay")) {
    return {
      border: "border-amber-300/25",
      bg: "bg-amber-300/10",
      text: "text-amber-100",
      dot: "bg-amber-300",
      hover: "hover:border-amber-300/40 hover:bg-amber-300/15",
    };
  }

  if (normalized.includes("kijiji")) {
    return {
      border: "border-violet-300/25",
      bg: "bg-violet-300/10",
      text: "text-violet-100",
      dot: "bg-violet-300",
      hover: "hover:border-violet-300/40 hover:bg-violet-300/15",
    };
  }

  return {
    border: "border-white/15",
    bg: "bg-white/[0.04]",
    text: "text-zinc-200",
    dot: "bg-zinc-400",
    hover: "hover:border-white/25 hover:bg-white/[0.06]",
  };
}

function SourceChip({
  source,
  selected,
  onClick,
  compact = false,
  className,
}: {
  source: string;
  selected?: boolean;
  onClick?: () => void;
  compact?: boolean;
  className?: string;
}) {
  const tone = getSourceChipTone(source);
  const content = (
    <>
      <span className={cn("size-1.5 rounded-full", tone.dot)} />
      <span>{formatSourceLabel(source) || source}</span>
    </>
  );

  const classes = cn(
    "inline-flex items-center gap-2 rounded-full border font-medium transition",
    compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-sm",
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          classes,
          selected
            ? cn(tone.border, tone.bg, tone.text)
            : cn("border-white/10 bg-white/[0.02] text-zinc-300", tone.hover),
        )}
      >
        {content}
      </button>
    );
  }

  return <span className={cn(classes, tone.border, tone.bg, tone.text)}>{content}</span>;
}

function getMarketplaceLogoMeta(source: string): {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
} | null {
  const normalized = source.toLowerCase();

  if (normalized.includes("facebook")) {
    return {
      src: "/marketplaces/facebook_logo.svg",
      alt: "Facebook Marketplace",
      width: 190,
      height: 36,
      className: "h-3.5",
    };
  }

  if (normalized.includes("ebay")) {
    return {
      src: "/marketplaces/EBay_logo.svg",
      alt: "eBay",
      width: 150,
      height: 44,
      className: "h-3.5",
    };
  }

  if (normalized.includes("kijiji")) {
    return {
      src: "/marketplaces/kijiji_logo.svg",
      alt: "Kijiji",
      width: 360,
      height: 120,
      className: "h-4",
    };
  }

  return null;
}

function MarketplaceSourceBadge({ source }: { source: string }) {
  const logo = getMarketplaceLogoMeta(source);

  if (!logo) {
    return (
      <SourceChip
        source={source}
        compact
        className="border-white/15 bg-black/55 text-zinc-100 backdrop-blur-md"
      />
    );
  }

  return (
    <span className="inline-flex items-center rounded-full border border-white/15 bg-black/60 px-2.5 py-1 backdrop-blur-md">
      <Image
        src={logo.src}
        alt={logo.alt}
        width={logo.width}
        height={logo.height}
        className={cn("w-auto max-w-[84px] opacity-95", logo.className)}
      />
    </span>
  );
}

function InsightPill({
  label,
  tone,
}: {
  label: string;
  tone: "emerald" | "amber" | "red" | "slate";
}) {
  const toneClasses = {
    emerald: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
    amber: "border-amber-300/25 bg-amber-300/10 text-amber-100",
    red: "border-red-300/25 bg-red-400/10 text-red-100",
    slate: "border-white/10 bg-white/[0.03] text-zinc-300",
  }[tone];

  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", toneClasses)}>
      {label}
    </span>
  );
}

function valuationTone(valuation?: Valuation | null): "emerald" | "amber" | "red" | "slate" {
  if (!valuation) return "slate";
  if (valuation.verdict === "underpriced") return "emerald";
  if (valuation.verdict === "overpriced") return "red";
  if (valuation.verdict === "fair") return "amber";
  return "slate";
}

function riskTone(risk?: Risk | null): "emerald" | "amber" | "red" | "slate" {
  if (!risk) return "slate";
  if (risk.level === "high") return "red";
  if (risk.level === "medium") return "amber";
  return "emerald";
}

function MarketplaceResultCard({
  item,
  deviceCoords,
}: {
  item: Listing;
  deviceCoords: Coordinates | null;
}) {
  const imageUrl = item.image_urls?.[0];
  const listingCoords = deviceCoords ? getListingCoordinates(item) : null;
  const distanceMiles =
    deviceCoords && listingCoords ? haversineMiles(deviceCoords, listingCoords) : null;
  const distanceLabel = distanceMiles !== null ? formatDistanceMiles(distanceMiles) : null;

  return (
    <li className="h-full">
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="group flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/85 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-zinc-950"
      >
        <div className="relative aspect-[5/4] shrink-0 overflow-hidden bg-zinc-900">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={item.title}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
              No image
            </div>
          )}

          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
            <MarketplaceSourceBadge source={item.source} />
          </div>
        </div>

        <div className="flex h-[196px] flex-col gap-2 overflow-hidden p-3.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-base font-semibold tracking-tight text-white">{formatPrice(item.price)}</p>
            {distanceLabel ? (
              <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-zinc-300">
                {distanceLabel}
              </span>
            ) : null}
          </div>

          <p className="line-clamp-2 text-sm font-medium leading-snug text-zinc-100 transition group-hover:text-white">
            {item.title}
          </p>

          <p className="line-clamp-1 text-xs text-zinc-400">
            {item.location || `${formatSourceLabel(item.source)} listing`}
          </p>

          <div className="flex flex-wrap gap-1.5">
            {item.valuation ? (
              <InsightPill
                label={
                  item.valuation.verdict === "insufficient_data"
                    ? "Value: pending"
                    : `Value: ${item.valuation.verdict.replace("_", " ")}`
                }
                tone={valuationTone(item.valuation)}
              />
            ) : null}
            {item.risk ? (
              <InsightPill label={`Risk: ${item.risk.level}`} tone={riskTone(item.risk)} />
            ) : null}
          </div>

          <div className="mt-auto space-y-1">
            {typeof item.score === "number" ? (
              <p className="text-[11px] text-zinc-500">Score {item.score.toFixed(2)}</p>
            ) : null}
            {item.valuation?.explanation ? (
              <p className="line-clamp-2 text-xs leading-relaxed text-zinc-400">
                {item.valuation.explanation}
                {item.valuation.estimated_low != null && item.valuation.estimated_high != null
                  ? ` | ${formatMoneyCompact(item.valuation.estimated_low, item.valuation.currency)}-${formatMoneyCompact(item.valuation.estimated_high, item.valuation.currency)}`
                  : ""}
              </p>
            ) : null}
            {item.risk?.reasons?.[0] && item.risk.level !== "low" ? (
              <p className="line-clamp-2 text-xs leading-relaxed text-amber-100/80">
                {item.risk.reasons[0]}
              </p>
            ) : null}
            {item.condition ? (
              <p className="line-clamp-1 text-[11px] uppercase tracking-[0.12em] text-zinc-500">
                {item.condition}
              </p>
            ) : null}
            {item.snippet ? (
              <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500">{item.snippet}</p>
            ) : null}
          </div>
        </div>
      </a>
    </li>
  );
}

function CopilotPanel({
  activeQuery,
  filteredResults,
  copilotOpen,
  toggleCopilotOpen,
  copilotQuestion,
  setCopilotQuestion,
  copilotLoading,
  copilotError,
  copilotResponse,
  onAskCopilot,
}: Pick<
  SearchPageViewProps,
  | "activeQuery"
  | "filteredResults"
  | "copilotOpen"
  | "toggleCopilotOpen"
  | "copilotQuestion"
  | "setCopilotQuestion"
  | "copilotLoading"
  | "copilotError"
  | "copilotResponse"
  | "onAskCopilot"
>) {
  const listingMap = useMemo(
    () => new Map(filteredResults.map((item) => [getListingKey(item), item])),
    [filteredResults],
  );
  const hasListings = filteredResults.length > 0 && activeQuery.trim().length > 0;
  const presets = [
    "Which is the best value?",
    "What should I ask the seller?",
    "What are the red flags?",
  ];

  return (
    <GlassPanel className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-zinc-300" />
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">Copilot</p>
            <p className="text-sm text-zinc-300">Ask about the listings currently on screen.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleCopilotOpen}
          className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 text-xs text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.05]"
        >
          {copilotOpen ? "Collapse" : "Open"}
        </button>
      </div>

      {copilotOpen ? (
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  setCopilotQuestion(preset);
                  void onAskCopilot(preset);
                }}
                disabled={!hasListings || copilotLoading}
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <textarea
              className="min-h-[108px] w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-white/20 focus:outline-none"
              placeholder="Ask about the currently loaded listings..."
              value={copilotQuestion}
              onChange={(event) => setCopilotQuestion(event.target.value)}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                Uses the top {Math.min(filteredResults.length, 25)} visible listings from this search.
              </p>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void onAskCopilot()}
                disabled={!hasListings || copilotLoading || !copilotQuestion.trim()}
              >
                {copilotLoading ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
                {copilotLoading ? "Thinking..." : "Ask copilot"}
              </button>
            </div>
          </div>

          {copilotError ? (
            <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">
              {copilotError}
            </div>
          ) : null}

          {copilotResponse ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Answer</p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-100">{copilotResponse.answer}</p>
                {!copilotResponse.available && copilotResponse.error_message ? (
                  <p className="mt-2 text-xs text-zinc-500">{copilotResponse.error_message}</p>
                ) : null}
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Shortlist</p>
                  <ul className="mt-2 space-y-2">
                    {copilotResponse.shortlist.length === 0 ? (
                      <li className="text-sm text-zinc-400">No shortlist yet.</li>
                    ) : (
                      copilotResponse.shortlist.map((entry) => {
                        const linkedListing = listingMap.get(entry.listing_key);
                        const content = (
                          <>
                            <p className="text-sm font-medium text-zinc-100">{entry.title}</p>
                            <p className="mt-1 text-xs text-zinc-400">{entry.reason}</p>
                          </>
                        );
                        return (
                          <li key={entry.listing_key}>
                            {linkedListing ? (
                              <a
                                href={linkedListing.url}
                                target="_blank"
                                rel="noreferrer"
                                className="block rounded-xl border border-white/10 bg-white/[0.02] p-3 transition hover:border-white/20 hover:bg-white/[0.04]"
                              >
                                {content}
                              </a>
                            ) : (
                              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                                {content}
                              </div>
                            )}
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Seller questions</p>
                    <ul className="mt-2 space-y-1.5 text-sm text-zinc-300">
                      {copilotResponse.seller_questions.length === 0 ? (
                        <li className="text-zinc-500">No questions suggested.</li>
                      ) : (
                        copilotResponse.seller_questions.map((entry) => <li key={entry}>- {entry}</li>)
                      )}
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Red flags</p>
                    <ul className="mt-2 space-y-1.5 text-sm text-zinc-300">
                      {copilotResponse.red_flags.length === 0 ? (
                        <li className="text-zinc-500">No extra red flags called out.</li>
                      ) : (
                        copilotResponse.red_flags.map((entry) => <li key={entry}>- {entry}</li>)
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </GlassPanel>
  );
}

function getListingCoordinates(listing: Listing): Coordinates | null {
  if (typeof listing.latitude !== "number" || typeof listing.longitude !== "number") {
    return null;
  }

  return {
    latitude: listing.latitude,
    longitude: listing.longitude,
  };
}

function formatDistanceMiles(distanceMiles: number) {
  if (!Number.isFinite(distanceMiles)) return null;
  if (distanceMiles < 10) return `${distanceMiles.toFixed(1)} mi away`;
  return `${Math.round(distanceMiles)} mi away`;
}

export default function HomePage() {
  const { user, loading: authLoading, signOut, accessToken } = useAuth();
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

  const [q, setQ] = useState("");
  const [sources, setSources] = useState<SourceOption[]>(DEFAULT_SOURCES);
  const [sortBy, setSortBy] = useState<SortOption>("relevance");
  const limit = DEFAULT_PAGE_SIZE;

  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawResults, setRawResults] = useState<Listing[]>([]);
  const [results, setResults] = useState<Listing[]>([]);
  const [sortApplying, setSortApplying] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [sourceErrors, setSourceErrors] = useState<Record<string, SourceErrorEntry>>({});
  const [hasSearched, setHasSearched] = useState(false);
  const [resultMode, setResultMode] = useState<ResultMode | null>(null);

  const [activeQuery, setActiveQuery] = useState("");
  const [activeSources, setActiveSources] = useState<SourceOption[]>(DEFAULT_SOURCES);
  const [activeSort, setActiveSort] = useState<SortOption>("relevance");
  const [activeLimit, setActiveLimit] = useState(DEFAULT_PAGE_SIZE);
  const [savedBatchPagination, setSavedBatchPagination] = useState<SavedBatchPaginationState | null>(null);

  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<SavedSearchNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [activeSavedSearchId, setActiveSavedSearchId] = useState<number | null>(null);
  const [locationFilterText, setLocationFilterText] = useState("");
  const [travelRangeMilesInput, setTravelRangeMilesInput] = useState("");
  const [deviceCoords, setDeviceCoords] = useState<Coordinates | null>(null);
  const [locatingDevice, setLocatingDevice] = useState(false);
  const [locationFilterError, setLocationFilterError] = useState<string | null>(null);
  const [hideUnknownDistance, setHideUnknownDistance] = useState(true);

  const [editing, setEditing] = useState<SavedSearch | null>(null);
  const [editQuery, setEditQuery] = useState("");
  const [editSources, setEditSources] = useState<SourceOption[]>([]);
  const [editAlertsEnabled, setEditAlertsEnabled] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(true);
  const [copilotQuestion, setCopilotQuestion] = useState("");
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [copilotResponse, setCopilotResponse] = useState<CopilotResponse | null>(null);
  const [facebookConfigStatus, setFacebookConfigStatus] = useState<FacebookConnectorStatus | null>(null);
  const [facebookConfigLoading, setFacebookConfigLoading] = useState(false);
  const [facebookConfigError, setFacebookConfigError] = useState<string | null>(null);
  const [facebookUploadBusy, setFacebookUploadBusy] = useState(false);
  const [facebookVerifyBusy, setFacebookVerifyBusy] = useState(false);
  const [facebookDeleteBusy, setFacebookDeleteBusy] = useState(false);
  const [facebookCookieJsonText, setFacebookCookieJsonText] = useState("");

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const seenKeysRef = useRef<Set<string>>(new Set());
  const fetchInFlightRef = useRef(false);
  const autoLoadedSavedForUserRef = useRef<string | null>(null);
  const savedBatchLaneStartRef = useRef(0);

  const savedBatchHasMore =
    resultMode === "saved_batch" &&
    savedBatchPagination !== null &&
    savedBatchPagination.entries.some((entry) => entry.nextOffset !== null);
  const hasMore =
    hasSearched &&
    (resultMode === "saved_batch" ? savedBatchHasMore : nextOffset !== null);
  const normalizedLocationFilterText = locationFilterText.trim().toLowerCase();
  const parsedTravelRangeMiles = Number(travelRangeMilesInput);
  const travelRangeMiles =
    travelRangeMilesInput.trim() !== "" &&
    Number.isFinite(parsedTravelRangeMiles) &&
    parsedTravelRangeMiles > 0
      ? parsedTravelRangeMiles
      : null;
  const distanceFilterActive = deviceCoords !== null && travelRangeMiles !== null;
  const distanceFilterPendingLocation = deviceCoords === null && travelRangeMiles !== null;

  useEffect(() => {
    const delayMs = sortDebounceMs(rawResults.length);
    if (delayMs <= 0) {
      setResults(sortListingsLocal(rawResults, sortBy));
      setSortApplying(false);
      return;
    }

    setSortApplying(true);
    const timeout = window.setTimeout(() => {
      setResults(sortListingsLocal(rawResults, sortBy));
      setSortApplying(false);
    }, delayMs);

    return () => window.clearTimeout(timeout);
  }, [rawResults, sortBy]);

  const filteredResults = useMemo(() => {
    return results.filter((item) => {
      if (normalizedLocationFilterText) {
        const listingLocation = (item.location ?? "").toLowerCase();
        if (!listingLocation.includes(normalizedLocationFilterText)) {
          return false;
        }
      }

      if (distanceFilterActive && deviceCoords && travelRangeMiles !== null) {
        const listingCoords = getListingCoordinates(item);
        if (!listingCoords) {
          return !hideUnknownDistance;
        }

        const distanceMiles = haversineMiles(deviceCoords, listingCoords);
        if (!Number.isFinite(distanceMiles) || distanceMiles > travelRangeMiles) {
          return false;
        }
      }

      return true;
    });
  }, [
    deviceCoords,
    distanceFilterActive,
    hideUnknownDistance,
    normalizedLocationFilterText,
    results,
    travelRangeMiles,
  ]);

  const hasActiveClientFilters =
    normalizedLocationFilterText.length > 0 || distanceFilterActive;
  const filteredOutCount = Math.max(0, results.length - filteredResults.length);

  const buildSearchUrl = useCallback(
    (
      query: string,
      selectedSources: SourceOption[],
      selectedLimit: number,
      offset: number,
    ) => {
      const params = new URLSearchParams();
      params.set("q", query);
      for (const source of selectedSources) {
        params.append("sources", source);
      }
      params.set("sort", "relevance");
      params.set("limit", String(selectedLimit));
      params.set("offset", String(offset));
      if (deviceCoords) {
        params.set("latitude", String(deviceCoords.latitude));
        params.set("longitude", String(deviceCoords.longitude));
      }
      if (travelRangeMiles !== null) {
        params.set("radius_km", String(Math.max(1, Math.round(travelRangeMiles * 1.60934))));
      }
      return `${API_BASE}/search?${params.toString()}`;
    },
    [API_BASE, deviceCoords, travelRangeMiles],
  );

  const runSearch = useCallback(
    async ({
      query,
      sourceList,
      selectedSort,
      selectedLimit,
      offset,
      append,
    }: {
      query: string;
      sourceList: SourceOption[];
      selectedSort: SortOption;
      selectedLimit: number;
      offset: number;
      append: boolean;
    }) => {
      if (fetchInFlightRef.current) return;
      fetchInFlightRef.current = true;

      if (append) {
        setLoadingMore(true);
      } else {
        setSearchLoading(true);
        setError(null);
        setCopilotError(null);
        setCopilotResponse(null);
        setRawResults([]);
        setResults([]);
        setNextOffset(null);
        setTotal(null);
        setSourceErrors({});
        setSavedBatchPagination(null);
        seenKeysRef.current = new Set();
      }

      try {
        const url = buildSearchUrl(query, sourceList, selectedLimit, offset);
        const res = await fetch(url, {
          cache: "no-store",
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`API error ${res.status}: ${text}`);
        }

        const json = await res.json();
        let incoming: Listing[] = [];
        let incomingNextOffset: number | null | undefined;
        let incomingTotal: number | null | undefined;
        let incomingSourceErrors: Record<string, SourceErrorEntry> = {};

        if (Array.isArray(json)) {
          incoming = json as Listing[];
        } else {
          const payload = json as SearchResponse;
          incoming = payload.results ?? [];
          incomingNextOffset = payload.next_offset;
          incomingTotal = payload.total ?? null;
          incomingSourceErrors = payload.source_errors ?? {};
        }

        const dedupedIncoming: Listing[] = [];
        for (const item of incoming) {
          const listingKey = getListingKey(item);
          if (seenKeysRef.current.has(listingKey)) continue;
          seenKeysRef.current.add(listingKey);
          dedupedIncoming.push(item);
        }

        if (append) {
          setRawResults((prev) => [...prev, ...dedupedIncoming]);
          setSourceErrors((prev) => ({ ...prev, ...incomingSourceErrors }));
        } else {
          setRawResults(dedupedIncoming);
          setSourceErrors(incomingSourceErrors);
          setActiveQuery(query);
          setActiveSources(sourceList);
          setActiveSort(selectedSort);
          setActiveLimit(selectedLimit);
          setHasSearched(true);
        }

        if (incomingTotal !== undefined) {
          setTotal(incomingTotal);
        } else {
          setTotal(null);
        }

        if (incomingNextOffset === undefined) {
          setNextOffset(incoming.length < selectedLimit ? null : offset + selectedLimit);
        } else {
          setNextOffset(incomingNextOffset);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (append) {
          setLoadingMore(false);
        } else {
          setSearchLoading(false);
        }
        fetchInFlightRef.current = false;
      }
    },
    [accessToken, buildSearchUrl],
  );

  function onUseMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationFilterError("Browser location is not available.");
      return;
    }

    setLocatingDevice(true);
    setLocationFilterError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDeviceCoords({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocatingDevice(false);
      },
      (geoError) => {
        setLocationFilterError(geoError.message || "Unable to get your location.");
        setLocatingDevice(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5 * 60 * 1000,
      },
    );
  }

  function onClearMyLocation() {
    setDeviceCoords(null);
    setLocationFilterError(null);
  }

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

  useEffect(() => {
    if (!accessToken) {
      setFacebookConfigStatus(null);
      setFacebookConfigError(null);
      return;
    }
    void fetchFacebookConfigStatus();
  }, [accessToken, fetchFacebookConfigStatus]);

  const uploadFacebookCookiePayload = useCallback(async (cookiePayload: unknown) => {
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
  }, [API_BASE, accessToken, parseApiError]);

  async function onSaveFacebookCookieJson() {
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
  }

  async function onVerifyFacebookCookies() {
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
  }

  async function onDeleteFacebookCookies() {
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
  }

  function onFacebookCookieFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
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
  }

  async function fetchSavedSearches(): Promise<SavedSearch[] | null> {
    setSavedLoading(true);
    setSavedError(null);

    try {
      if (!accessToken) {
        setSaved([]);
        return [];
      }

      const res = await fetch(`${API_BASE}/saved-searches`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`GET /saved-searches failed (${res.status}): ${text}`);
      }

      const json = (await res.json()) as SavedSearch[];
      setSaved(json);
      return json;
    } catch (err: unknown) {
      setSavedError(err instanceof Error ? err.message : "Failed to load saved searches");
      return null;
    } finally {
      setSavedLoading(false);
    }
  }

  async function fetchNotifications(): Promise<SavedSearchNotification[] | null> {
    setNotificationsLoading(true);
    setNotificationsError(null);

    try {
      if (!accessToken) {
        setNotifications([]);
        return [];
      }

      const res = await fetch(`${API_BASE}/me/notifications`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`GET /me/notifications failed (${res.status}): ${text}`);
      }

      const json = (await res.json()) as SavedSearchNotification[];
      setNotifications(json);
      return json;
    } catch (err: unknown) {
      setNotificationsError(err instanceof Error ? err.message : "Failed to load notifications");
      return null;
    } finally {
      setNotificationsLoading(false);
    }
  }

  const fetchSavedSearchPage = useCallback(async (
    entry: SavedSearch | SavedBatchPaginationEntry,
    {
      selectedLimit,
      offset,
    }: {
      selectedLimit: number;
      offset: number;
    },
  ): Promise<SearchResponse> => {
    if (!accessToken) throw new Error("Please log in again.");

    const params = new URLSearchParams();
    params.set("sort", "relevance");
    params.set("limit", String(selectedLimit));
    params.set("offset", String(offset));
    if (deviceCoords) {
      params.set("latitude", String(deviceCoords.latitude));
      params.set("longitude", String(deviceCoords.longitude));
    }
    if (travelRangeMiles !== null) {
      params.set("radius_km", String(Math.max(1, Math.round(travelRangeMiles * 1.60934))));
    }

    const res = await fetch(`${API_BASE}/saved-searches/${entry.id}/run?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${entry.query} (${res.status}): ${text}`);
    }

    return (await res.json()) as SearchResponse;
  }, [API_BASE, accessToken, deviceCoords, travelRangeMiles]);

  const loadMoreSavedBatch = useCallback(async () => {
    if (
      !accessToken ||
      resultMode !== "saved_batch" ||
      !savedBatchPagination ||
      searchLoading ||
      loadingMore ||
      fetchInFlightRef.current
    ) {
      return;
    }

    const pendingEntries = savedBatchPagination.entries.filter((entry) => entry.nextOffset !== null);
    if (pendingEntries.length === 0) return;

    fetchInFlightRef.current = true;
    setLoadingMore(true);

    try {
      const requests = pendingEntries.map(async (entry) => ({
        entryId: entry.id,
        payload: await fetchSavedSearchPage(entry, {
          selectedLimit: savedBatchPagination.selectedLimit,
          offset: entry.nextOffset ?? 0,
        }),
      }));

      const settled = await Promise.allSettled(requests);
      const failures: string[] = [];
      const mergedSourceErrors: Record<string, SourceErrorEntry> = {};
      const nextOffsetsById = new Map<number, number | null>();
      const dedupedIncoming: Listing[] = [];
      const incomingBuckets: SavedSearchResultBucket[] = [];

      for (const outcome of settled) {
        if (outcome.status === "rejected") {
          failures.push(outcome.reason instanceof Error ? outcome.reason.message : "Unknown error");
          continue;
        }

        const { entryId, payload } = outcome.value;
        nextOffsetsById.set(entryId, payload.next_offset ?? null);
        Object.assign(mergedSourceErrors, payload.source_errors ?? {});

        const incomingItems = payload.results ?? [];
        if (savedBatchPagination.selectedSort === "relevance") {
          incomingBuckets.push({ items: incomingItems });
        } else {
          for (const item of incomingItems) {
            const listingKey = getListingKey(item);
            if (seenKeysRef.current.has(listingKey)) continue;
            seenKeysRef.current.add(listingKey);
            dedupedIncoming.push(item);
          }
        }
      }

      if (savedBatchPagination.selectedSort === "relevance" && incomingBuckets.length > 0) {
        const interleaved = interleaveSavedSearchBuckets({
          buckets: incomingBuckets,
          laneStart: savedBatchLaneStartRef.current,
          initialSeenKeys: seenKeysRef.current,
        });
        dedupedIncoming.push(...interleaved.orderedItems);
        seenKeysRef.current = interleaved.seenKeys;
        savedBatchLaneStartRef.current = interleaved.nextLaneStart;
      }

      if (settled.length > 0 && failures.length === settled.length) {
        throw new Error(`Failed to load more saved-search results: ${failures[0]}`);
      }

      if (dedupedIncoming.length > 0) {
        setRawResults((prev) => [...prev, ...dedupedIncoming]);
      }

      if (Object.keys(mergedSourceErrors).length > 0) {
        setSourceErrors((prev) => ({ ...prev, ...mergedSourceErrors }));
      }

      const updatedPagination: SavedBatchPaginationState = {
        ...savedBatchPagination,
        entries: savedBatchPagination.entries.map((entry) => {
          if (!nextOffsetsById.has(entry.id)) {
            return entry;
          }
          return {
            ...entry,
            nextOffset: nextOffsetsById.get(entry.id) ?? null,
          };
        }),
      };

      setSavedBatchPagination(updatedPagination);
      const batchHasMore = updatedPagination.entries.some((entry) => entry.nextOffset !== null);
      setTotal(batchHasMore ? null : results.length + dedupedIncoming.length);

      if (failures.length > 0) {
        setError(`Some saved searches failed to load more (${failures.length}/${settled.length}).`);
      } else {
        setError(null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load more saved-search results");
    } finally {
      setLoadingMore(false);
      fetchInFlightRef.current = false;
    }
  }, [
    accessToken,
    fetchSavedSearchPage,
    loadingMore,
    resultMode,
    results.length,
    savedBatchPagination,
    searchLoading,
  ]);

  const loadMore = useCallback(async () => {
    if (resultMode === "saved_batch") {
      if (!hasMore || searchLoading || loadingMore || fetchInFlightRef.current) return;
      await loadMoreSavedBatch();
      return;
    }

    if (!hasMore || nextOffset === null || searchLoading || loadingMore || fetchInFlightRef.current) {
      return;
    }

    await runSearch({
      query: activeQuery,
      sourceList: activeSources,
      selectedSort: activeSort,
      selectedLimit: activeLimit,
      offset: nextOffset,
      append: true,
    });
  }, [
    activeLimit,
    activeQuery,
    activeSort,
    activeSources,
    hasMore,
    loadMoreSavedBatch,
    loadingMore,
    nextOffset,
    resultMode,
    runSearch,
    searchLoading,
  ]);

  useEffect(() => {
    if (!hasMore || searchLoading || loadingMore) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting) {
          void loadMore();
        }
      },
      { rootMargin: "300px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loadingMore, searchLoading]);

  async function runAllSavedSearches(
    savedSearches: SavedSearch[],
    {
      selectedSort = sortBy,
      selectedLimit = limit,
    }: {
      selectedSort?: SortOption;
      selectedLimit?: number;
    } = {},
  ) {
    if (!accessToken || savedSearches.length === 0 || fetchInFlightRef.current) return;

    fetchInFlightRef.current = true;
    setSearchLoading(true);
    setLoadingMore(false);
    setError(null);
    setCopilotError(null);
    setCopilotResponse(null);
    setRawResults([]);
    setResults([]);
    setNextOffset(null);
    setTotal(null);
    setSourceErrors({});
    setSavedBatchPagination(null);
    setHasSearched(false);
    setActiveSavedSearchId(null);
    seenKeysRef.current = new Set();
    const seededLaneStart = computeSavedBatchSeed(savedSearches);
    savedBatchLaneStartRef.current = seededLaneStart;

    try {
      const requests = savedSearches.map(async (entry) => ({
        entry,
        payload: await fetchSavedSearchPage(entry, {
          selectedLimit,
          offset: 0,
        }),
      }));

      const settled = await Promise.allSettled(requests);
      const dedupedResults: Listing[] = [];
      const mergedSourceErrors: Record<string, SourceErrorEntry> = {};
      const seenKeys = new Set<string>();
      const failures: string[] = [];
      const paginationEntries: SavedBatchPaginationEntry[] = [];
      const initialBuckets: SavedSearchResultBucket[] = [];

      for (const outcome of settled) {
        if (outcome.status === "rejected") {
          failures.push(outcome.reason instanceof Error ? outcome.reason.message : "Unknown error");
          continue;
        }

        const { entry, payload } = outcome.value;
        const normalizedSources = entry.sources.filter(isSourceOption);
        paginationEntries.push({
          id: entry.id,
          query: entry.query,
          sources: normalizedSources,
          nextOffset: payload.next_offset ?? null,
        });

        const initialItems = payload.results ?? [];
        initialBuckets.push({ items: initialItems });
        if (selectedSort !== "relevance") {
          for (const item of initialItems) {
            const listingKey = getListingKey(item);
            if (seenKeys.has(listingKey)) continue;
            seenKeys.add(listingKey);
            dedupedResults.push(item);
          }
        }

        Object.assign(mergedSourceErrors, payload.source_errors ?? {});
      }

      if (selectedSort === "relevance") {
        const interleaved = interleaveSavedSearchBuckets({
          buckets: initialBuckets,
          laneStart: seededLaneStart,
          initialSeenKeys: seenKeys,
        });
        dedupedResults.push(...interleaved.orderedItems);
        seenKeysRef.current = interleaved.seenKeys;
        savedBatchLaneStartRef.current = interleaved.nextLaneStart;
      } else {
        seenKeysRef.current = seenKeys;
      }

      if (settled.length > 0 && failures.length === settled.length) {
        throw new Error(`Failed to auto-load saved searches: ${failures[0]}`);
      }

      if (failures.length > 0) {
        setError(`Some saved searches failed to load (${failures.length}/${settled.length}).`);
      }

      setRawResults(dedupedResults);
      setSourceErrors(mergedSourceErrors);
      const nextSavedBatchPagination: SavedBatchPaginationState = {
        selectedSort,
        selectedLimit,
        entries: paginationEntries,
      };
      const batchHasMore = nextSavedBatchPagination.entries.some((entry) => entry.nextOffset !== null);
      setSavedBatchPagination(nextSavedBatchPagination);
      setTotal(batchHasMore ? null : dedupedResults.length);
      setNextOffset(null);
      setActiveQuery("Saved searches");
      setActiveSources(
        Array.from(
          new Set(savedSearches.flatMap((entry) => entry.sources.filter(isSourceOption))),
        ) as SourceOption[],
      );
      setActiveSort(selectedSort);
      setActiveLimit(selectedLimit);
      setResultMode("saved_batch");
      setHasSearched(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to auto-load saved searches");
    } finally {
      setSearchLoading(false);
      fetchInFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (user) {
      void (async () => {
        const fetched = await fetchSavedSearches();
        void fetchNotifications();
        if (!fetched) return;

        if (autoLoadedSavedForUserRef.current === user.id) return;
        autoLoadedSavedForUserRef.current = user.id;

        if (fetched.length > 0) {
          await runAllSavedSearches(fetched);
        }
      })();
    } else {
      autoLoadedSavedForUserRef.current = null;
      setSaved([]);
      setNotifications([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, accessToken]);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query || sources.length === 0) return;

    setActiveSavedSearchId(null);
    setResultMode("single");
    await runSearch({
      query,
      sourceList: sources,
      selectedSort: sortBy,
      selectedLimit: limit,
      offset: 0,
      append: false,
    });
  }

  async function onSaveCurrentSearch() {
    setSavedError(null);

    try {
      if (!accessToken) throw new Error("Please log in to save searches.");
      if (sources.length === 0) throw new Error("Select at least one source.");

      const payload = {
        query: q.trim(),
        sources,
        alerts_enabled: true,
      };

      const res = await fetch(`${API_BASE}/saved-searches`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`POST /saved-searches failed (${res.status}): ${text}`);
      }

      await fetchSavedSearches();
    } catch (err: unknown) {
      setSavedError(err instanceof Error ? err.message : "Failed to save search");
    }
  }

  async function onDeleteSavedSearch(id: number) {
    setSavedError(null);

    try {
      if (!accessToken) throw new Error("Please log in to delete saved searches.");

      const res = await fetch(`${API_BASE}/saved-searches/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`DELETE /saved-searches/${id} failed (${res.status}): ${text}`);
      }

      if (activeSavedSearchId === id) {
        setActiveSavedSearchId(null);
      }
      await fetchSavedSearches();
    } catch (err: unknown) {
      setSavedError(err instanceof Error ? err.message : "Failed to delete saved search");
    }
  }

  async function onToggleSavedSearchAlerts(entry: SavedSearch) {
    setSavedError(null);

    try {
      if (!accessToken) throw new Error("Please log in to update alert settings.");

      const res = await fetch(`${API_BASE}/saved-searches/${entry.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          query: entry.query,
          sources: entry.sources,
          alerts_enabled: !entry.alerts_enabled,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`PATCH /saved-searches/${entry.id} failed (${res.status}): ${text}`);
      }

      const updated = (await res.json()) as SavedSearch;
      setSaved((prev) => prev.map((candidate) => (candidate.id === updated.id ? updated : candidate)));
    } catch (err: unknown) {
      setSavedError(err instanceof Error ? err.message : "Failed to update alert settings");
    }
  }

  async function onRunSavedSearch(id: number) {
    try {
      const savedSearch = saved.find((entry) => entry.id === id);
      if (!savedSearch) throw new Error("Saved search not found.");

      const normalizedSources = savedSearch.sources.filter(isSourceOption);
      if (normalizedSources.length === 0) throw new Error("Saved search has no valid sources.");

      setQ(savedSearch.query);
      setSources(normalizedSources);
      setActiveSavedSearchId(id);
      setResultMode("single");

      await runSearch({
        query: savedSearch.query,
        sourceList: normalizedSources,
        selectedSort: sortBy,
        selectedLimit: limit,
        offset: 0,
        append: false,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to run saved search");
    }
  }

  async function onChangeSort(nextSort: SortOption) {
    setSortBy(nextSort);
    setActiveSort(nextSort);
    setSavedBatchPagination((prev) =>
      prev
        ? {
            ...prev,
            selectedSort: nextSort,
          }
        : prev,
    );
  }

  function toggleSource(source: SourceOption) {
    setSources((prev) => (prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source]));
  }

  function openEdit(entry: SavedSearch) {
    setEditing(entry);
    setEditQuery(entry.query);
    setEditSources(entry.sources.filter(isSourceOption));
    setEditAlertsEnabled(entry.alerts_enabled);
    setEditError(null);
  }

  function closeEdit() {
    setEditing(null);
    setEditError(null);
    setEditSaving(false);
    setEditAlertsEnabled(true);
  }

  function toggleEditSource(source: SourceOption) {
    setEditSources((prev) =>
      prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source],
    );
  }

  async function onSaveEdit() {
    if (!editing) return;
    setEditError(null);

    if (!accessToken) {
      setEditError("Please log in again");
      return;
    }

    const trimmedQuery = editQuery.trim();
    if (!trimmedQuery) {
      setEditError("Query cannot be empty.");
      return;
    }

    if (editSources.length === 0) {
      setEditError("Select at least one source.");
      return;
    }

    setEditSaving(true);
    try {
      const res = await fetch(`${API_BASE}/saved-searches/${editing.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          query: trimmedQuery,
          sources: editSources,
          alerts_enabled: editAlertsEnabled,
        }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("Please log in again");
        }
        if (res.status === 409) {
          throw new Error("That saved search already exists");
        }
        throw new Error("Failed to update saved search");
      }

      const updated = (await res.json()) as SavedSearch;
      setSaved((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));

      if (activeSavedSearchId === updated.id) {
        const normalizedSources = updated.sources.filter(isSourceOption);
        setQ(updated.query);
        setSources(normalizedSources);

        if (hasSearched) {
          void runSearch({
            query: updated.query,
            sourceList: normalizedSources,
            selectedSort: sortBy,
            selectedLimit: limit,
            offset: 0,
            append: false,
          });
        } else {
          setActiveQuery(updated.query);
          setActiveSources(normalizedSources);
        }
      }

      closeEdit();
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Failed to update saved search");
    } finally {
      setEditSaving(false);
    }
  }

  async function onMarkNotificationRead(id: number) {
    setNotificationsError(null);

    try {
      if (!accessToken) throw new Error("Please log in to manage notifications.");
      const res = await fetch(`${API_BASE}/me/notifications/${id}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`POST /me/notifications/${id}/read failed (${res.status}): ${text}`);
      }
      const updated = (await res.json()) as SavedSearchNotification;
      setNotifications((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
    } catch (err: unknown) {
      setNotificationsError(err instanceof Error ? err.message : "Failed to mark notification as read");
    }
  }

  const onAskCopilot = useCallback(async (questionOverride?: string) => {
    const question = (questionOverride ?? copilotQuestion).trim();
    const query = (activeQuery || q).trim();
    const listingContext = filteredResults.slice(0, 25).map((item) => ({
      listing_key: getListingKey(item),
      source: item.source,
      source_listing_id: item.source_listing_id,
      title: item.title,
      price: item.price ?? null,
      location: item.location ?? null,
      snippet: item.snippet ?? null,
      score: item.score ?? null,
      valuation: item.valuation ?? null,
      risk: item.risk ?? null,
    }));

    if (!question || !query || listingContext.length === 0) {
      setCopilotError("Run a search first, then ask about the visible listings.");
      return;
    }

    setCopilotLoading(true);
    setCopilotError(null);
    try {
      const res = await fetch(`${API_BASE}/copilot/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          user_question: question,
          listings: listingContext,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`POST /copilot/query failed (${res.status}): ${text}`);
      }
      const json = (await res.json()) as CopilotResponse;
      setCopilotResponse(json);
      if (!json.available && json.error_message) {
        setCopilotError(json.error_message);
      }
    } catch (err: unknown) {
      setCopilotResponse(null);
      setCopilotError(err instanceof Error ? err.message : "Failed to query copilot");
    } finally {
      setCopilotLoading(false);
    }
  }, [API_BASE, activeQuery, copilotQuestion, filteredResults, q]);

  const hasSourceErrorEntries = Object.keys(sourceErrors).length > 0;
  const summarySources = hasSearched && activeSources.length > 0 ? activeSources : sources;
  const totalResultsCount = total ?? rawResults.length;

  return (
    <SearchPageView
      authLoading={authLoading}
      user={user}
      signOut={signOut}
      q={q}
      setQ={setQ}
      sources={sources}
      sortBy={sortBy}
      sortApplying={sortApplying}
      onChangeSort={onChangeSort}
      toggleSource={toggleSource}
      searchLoading={searchLoading}
      loadingMore={loadingMore}
      onSearch={onSearch}
      onSaveCurrentSearch={onSaveCurrentSearch}
      limit={limit}
      locationFilterText={locationFilterText}
      setLocationFilterText={setLocationFilterText}
      onUseMyLocation={onUseMyLocation}
      onClearMyLocation={onClearMyLocation}
      locatingDevice={locatingDevice}
      deviceCoords={deviceCoords}
      locationFilterError={locationFilterError}
      travelRangeMilesInput={travelRangeMilesInput}
      setTravelRangeMilesInput={setTravelRangeMilesInput}
      hideUnknownDistance={hideUnknownDistance}
      setHideUnknownDistance={setHideUnknownDistance}
      distanceFilterPendingLocation={distanceFilterPendingLocation}
      distanceFilterActive={distanceFilterActive}
      error={error}
      sourceErrors={sourceErrors}
      hasSourceErrorEntries={hasSourceErrorEntries}
      hasSearched={hasSearched}
      results={results}
      filteredResults={filteredResults}
      resultMode={resultMode}
      total={total}
      totalResultsCount={totalResultsCount}
      hasActiveClientFilters={hasActiveClientFilters}
      filteredOutCount={filteredOutCount}
      summarySources={summarySources}
      sentinelRef={sentinelRef}
      hasMore={hasMore}
      saved={saved}
      savedLoading={savedLoading}
      savedError={savedError}
      notifications={notifications}
      notificationsLoading={notificationsLoading}
      notificationsError={notificationsError}
      activeSavedSearchId={activeSavedSearchId}
      fetchSavedSearches={fetchSavedSearches}
      fetchNotifications={fetchNotifications}
      onMarkNotificationRead={onMarkNotificationRead}
      runAllSavedSearches={runAllSavedSearches}
      onRunSavedSearch={onRunSavedSearch}
      onDeleteSavedSearch={onDeleteSavedSearch}
      onToggleSavedSearchAlerts={onToggleSavedSearchAlerts}
      openEdit={openEdit}
      editing={editing}
      closeEdit={closeEdit}
      editError={editError}
      editSaving={editSaving}
      editQuery={editQuery}
      setEditQuery={setEditQuery}
      editSources={editSources}
      toggleEditSource={toggleEditSource}
      editAlertsEnabled={editAlertsEnabled}
      setEditAlertsEnabled={setEditAlertsEnabled}
      onSaveEdit={onSaveEdit}
      facebookConfigStatus={facebookConfigStatus}
      facebookConfigLoading={facebookConfigLoading}
      facebookConfigError={facebookConfigError}
      facebookUploadBusy={facebookUploadBusy}
      facebookVerifyBusy={facebookVerifyBusy}
      facebookDeleteBusy={facebookDeleteBusy}
      facebookCookieJsonText={facebookCookieJsonText}
      setFacebookCookieJsonText={setFacebookCookieJsonText}
      onSaveFacebookCookieJson={onSaveFacebookCookieJson}
      onVerifyFacebookCookies={onVerifyFacebookCookies}
      onDeleteFacebookCookies={onDeleteFacebookCookies}
      onFacebookCookieFileSelected={onFacebookCookieFileSelected}
      activeQuery={activeQuery}
      copilotOpen={copilotOpen}
      toggleCopilotOpen={() => setCopilotOpen((prev) => !prev)}
      copilotQuestion={copilotQuestion}
      setCopilotQuestion={setCopilotQuestion}
      copilotLoading={copilotLoading}
      copilotError={copilotError}
      copilotResponse={copilotResponse}
      onAskCopilot={onAskCopilot}
    />
  );
}
