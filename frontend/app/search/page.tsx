"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Bookmark,
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
import V0Icon from "@/components/icons/v0-icon";
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

type SourceOption = (typeof SOURCE_OPTIONS)[number];
type SortOption = (typeof SORT_OPTIONS)[number]["value"];

type Money = {
  amount: number;
  currency: string;
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

type SavedSearch = {
  id: number;
  query: string;
  sources: string[];
  created_at: string;
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

function isSourceOption(value: string): value is SourceOption {
  return SOURCE_OPTIONS.includes(value as SourceOption);
}

function formatPrice(price?: Money | null) {
  if (!price) return "-";
  return `${price.currency} ${price.amount}`;
}

function formatSourceLabel(source: string) {
  if (!source) return "";
  return source
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
  activeSavedSearchId: number | null;
  fetchSavedSearches: () => Promise<SavedSearch[] | null>;
  runAllSavedSearches: (savedSearches: SavedSearch[]) => Promise<void>;
  onRunSavedSearch: (id: number) => Promise<void>;
  onDeleteSavedSearch: (id: number) => Promise<void>;
  openEdit: (entry: SavedSearch) => void;
  editing: SavedSearch | null;
  closeEdit: () => void;
  editError: string | null;
  editSaving: boolean;
  editQuery: string;
  setEditQuery: React.Dispatch<React.SetStateAction<string>>;
  editSources: SourceOption[];
  toggleEditSource: (source: SourceOption) => void;
  onSaveEdit: () => Promise<void>;
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
  | "openEdit"
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
>;

function SearchPageView(props: SearchPageViewProps) {
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
              <V0Icon size={18} className="text-white" />
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
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] p-1 pl-3">
                <span className="hidden max-w-[220px] truncate text-xs text-zinc-300 sm:inline">
                  {props.user.email ?? "Signed in"}
                </span>
                <button
                  type="button"
                  onClick={() => void props.signOut()}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-zinc-100 transition hover:border-white/20 hover:bg-white/[0.08]"
                >
                  <LogOut className="size-3.5" />
                  Logout
                </button>
              </div>
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
                {props.hasSearched ? props.q.trim() || "Unified results" : "All marketplaces. One search."}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-400 sm:text-base">
                {props.hasSearched
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
              <StatTile label="Sources" value={String((props.summarySources.length > 0 ? props.summarySources : props.sources).length)} sub="Kijiji, eBay, Facebook" />
            </div>
          </div>
        </GlassPanel>

        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            <SearchControlsRail {...props} />
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
            Saved searches can auto-load a multi-query feed when you come back.
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
                  <p className="mt-1 text-[11px] text-zinc-500">Saved #{entry.id}</p>
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
}: ResultsPanelProps) {
  return (
    <section className="space-y-4">
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
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-white">
                Facebook Marketplace-style cards, but cross-platform
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-400">
                Listings will appear here as image-first tiles with price, title, source, and location
                prioritized for fast scanning. Filters stay visible in the left rail while you browse.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {SOURCE_OPTIONS.map((source) => (
                  <SourceChip key={`preview-${source}`} source={source} compact />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={`preview-card-${index}`}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80"
                >
                  <div className="aspect-[5/4] bg-gradient-to-br from-zinc-800 to-zinc-950" />
                  <div className="space-y-2 p-3">
                    <div className="h-4 w-16 rounded bg-zinc-800" />
                    <div className="h-3 w-full rounded bg-zinc-900" />
                    <div className="h-3 w-2/3 rounded bg-zinc-900" />
                  </div>
                </div>
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
    <li>
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="group block overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/85 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-zinc-950"
      >
        <div className="relative aspect-[5/4] overflow-hidden bg-zinc-900">
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

        <div className="space-y-2 p-3.5">
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

          {(typeof item.score === "number" || item.condition || item.snippet) && (
            <div className="space-y-1">
              {typeof item.score === "number" ? (
                <p className="text-[11px] text-zinc-500">Score {item.score.toFixed(2)}</p>
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
          )}
        </div>
      </a>
    </li>
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
  const [results, setResults] = useState<Listing[]>([]);
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
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const seenKeysRef = useRef<Set<string>>(new Set());
  const fetchInFlightRef = useRef(false);
  const autoLoadedSavedForUserRef = useRef<string | null>(null);

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
      selectedSort: SortOption,
      selectedLimit: number,
      offset: number,
    ) => {
      const params = new URLSearchParams();
      params.set("q", query);
      for (const source of selectedSources) {
        params.append("sources", source);
      }
      params.set("sort", selectedSort);
      params.set("limit", String(selectedLimit));
      params.set("offset", String(offset));
      return `${API_BASE}/search?${params.toString()}`;
    },
    [API_BASE],
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
        setResults([]);
        setNextOffset(null);
        setTotal(null);
        setSourceErrors({});
        setSavedBatchPagination(null);
        seenKeysRef.current = new Set();
      }

      try {
        const url = buildSearchUrl(query, sourceList, selectedSort, selectedLimit, offset);
        const res = await fetch(url, { cache: "no-store" });
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
          const listingKey = `${item.source}:${item.source_listing_id || item.url}`;
          if (seenKeysRef.current.has(listingKey)) continue;
          seenKeysRef.current.add(listingKey);
          dedupedIncoming.push(item);
        }

        if (append) {
          setResults((prev) => [...prev, ...dedupedIncoming]);
          setSourceErrors((prev) => ({ ...prev, ...incomingSourceErrors }));
        } else {
          setResults(dedupedIncoming);
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
    [buildSearchUrl],
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

  const fetchSavedSearchPage = useCallback(async (
    entry: SavedSearch | SavedBatchPaginationEntry,
    {
      selectedSort,
      selectedLimit,
      offset,
    }: {
      selectedSort: SortOption;
      selectedLimit: number;
      offset: number;
    },
  ): Promise<SearchResponse> => {
    if (!accessToken) throw new Error("Please log in again.");

    const params = new URLSearchParams();
    params.set("sort", selectedSort);
    params.set("limit", String(selectedLimit));
    params.set("offset", String(offset));

    const res = await fetch(`${API_BASE}/saved-searches/${entry.id}/run?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${entry.query} (${res.status}): ${text}`);
    }

    return (await res.json()) as SearchResponse;
  }, [API_BASE, accessToken]);

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
          selectedSort: savedBatchPagination.selectedSort,
          selectedLimit: savedBatchPagination.selectedLimit,
          offset: entry.nextOffset ?? 0,
        }),
      }));

      const settled = await Promise.allSettled(requests);
      const failures: string[] = [];
      const mergedSourceErrors: Record<string, SourceErrorEntry> = {};
      const nextOffsetsById = new Map<number, number | null>();
      const dedupedIncoming: Listing[] = [];

      for (const outcome of settled) {
        if (outcome.status === "rejected") {
          failures.push(outcome.reason instanceof Error ? outcome.reason.message : "Unknown error");
          continue;
        }

        const { entryId, payload } = outcome.value;
        nextOffsetsById.set(entryId, payload.next_offset ?? null);
        Object.assign(mergedSourceErrors, payload.source_errors ?? {});

        for (const item of payload.results ?? []) {
          const listingKey = `${item.source}:${item.source_listing_id || item.url}`;
          if (seenKeysRef.current.has(listingKey)) continue;
          seenKeysRef.current.add(listingKey);
          dedupedIncoming.push(item);
        }
      }

      if (settled.length > 0 && failures.length === settled.length) {
        throw new Error(`Failed to load more saved-search results: ${failures[0]}`);
      }

      if (dedupedIncoming.length > 0) {
        setResults((prev) => [...prev, ...dedupedIncoming]);
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
    setResults([]);
    setNextOffset(null);
    setTotal(null);
    setSourceErrors({});
    setSavedBatchPagination(null);
    setHasSearched(false);
    setActiveSavedSearchId(null);
    seenKeysRef.current = new Set();

    try {
      const requests = savedSearches.map(async (entry) => ({
        entry,
        payload: await fetchSavedSearchPage(entry, {
          selectedSort,
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

        for (const item of payload.results ?? []) {
          const listingKey = `${item.source}:${item.source_listing_id || item.url}`;
          if (seenKeys.has(listingKey)) continue;
          seenKeys.add(listingKey);
          dedupedResults.push(item);
        }

        Object.assign(mergedSourceErrors, payload.source_errors ?? {});
      }

      if (settled.length > 0 && failures.length === settled.length) {
        throw new Error(`Failed to auto-load saved searches: ${failures[0]}`);
      }

      if (failures.length > 0) {
        setError(`Some saved searches failed to load (${failures.length}/${settled.length}).`);
      }

      seenKeysRef.current = seenKeys;
      setResults(dedupedResults);
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
    if (!hasSearched) return;

    if (resultMode === "saved_batch") {
      await runAllSavedSearches(saved, {
        selectedSort: nextSort,
        selectedLimit: limit,
      });
      return;
    }

    await runSearch({
      query: activeQuery,
      sourceList: activeSources,
      selectedSort: nextSort,
      selectedLimit: activeLimit,
      offset: 0,
      append: false,
    });
  }

  function toggleSource(source: SourceOption) {
    setSources((prev) => (prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source]));
  }

  function openEdit(entry: SavedSearch) {
    setEditing(entry);
    setEditQuery(entry.query);
    setEditSources(entry.sources.filter(isSourceOption));
    setEditError(null);
  }

  function closeEdit() {
    setEditing(null);
    setEditError(null);
    setEditSaving(false);
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

  const hasSourceErrorEntries = Object.keys(sourceErrors).length > 0;
  const summarySources = hasSearched && activeSources.length > 0 ? activeSources : sources;
  const totalResultsCount = total ?? results.length;

  return (
    <SearchPageView
      authLoading={authLoading}
      user={user}
      signOut={signOut}
      q={q}
      setQ={setQ}
      sources={sources}
      sortBy={sortBy}
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
      activeSavedSearchId={activeSavedSearchId}
      fetchSavedSearches={fetchSavedSearches}
      runAllSavedSearches={runAllSavedSearches}
      onRunSavedSearch={onRunSavedSearch}
      onDeleteSavedSearch={onDeleteSavedSearch}
      openEdit={openEdit}
      editing={editing}
      closeEdit={closeEdit}
      editError={editError}
      editSaving={editSaving}
      editQuery={editQuery}
      setEditQuery={setEditQuery}
      editSources={editSources}
      toggleEditSource={toggleEditSource}
      onSaveEdit={onSaveEdit}
    />
  );
}
