"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
  ArrowUpRight,
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
  X,
} from "lucide-react";
import Dither from "@/components/Dither";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAuth } from "../providers";

const SOURCE_OPTIONS = ["kijiji", "ebay", "facebook"] as const;
const DEFAULT_SOURCES: SourceOption[] = ["kijiji", "ebay", "facebook"];
const DEFAULT_PAGE_SIZE = 24;
const COPILOT_DESKTOP_BREAKPOINT = 1024;
const COPILOT_FLOATING_MARGIN = 24;
const COPILOT_LAUNCHER_WIDTH = 196;
const COPILOT_LAUNCHER_HEIGHT = 72;
const COPILOT_WINDOW_WIDTH_DEFAULT = 440;
const COPILOT_WINDOW_WIDTH_MIN = 360;
const COPILOT_WINDOW_WIDTH_MAX = 860;
const COPILOT_WINDOW_HEIGHT_DEFAULT = 720;
const COPILOT_WINDOW_HEIGHT_MIN = 480;
const COPILOT_WINDOW_HEIGHT_MAX = 920;
const COPILOT_WINDOW_WIDTH_STORAGE_KEY = "marketly:copilot-window-width";
const COPILOT_WINDOW_RECT_STORAGE_KEY = "marketly:copilot-window-rect";
const COPILOT_LAUNCHER_POSITION_STORAGE_KEY = "marketly:copilot-launcher-position";
const SEARCH_LOCATION_STORAGE_KEY = "marketly:search-location";
const SORT_OPTIONS = [
  { value: "relevance", label: "Relevance", disabled: false },
  { value: "price_asc", label: "Price: Low -> High", disabled: false },
  { value: "price_desc", label: "Price: High -> Low", disabled: false },
  { value: "newest", label: "Newest", disabled: false },
] as const;
const PROVINCE_OPTIONS = [
  { code: "AB", label: "Alberta" },
  { code: "BC", label: "British Columbia" },
  { code: "MB", label: "Manitoba" },
  { code: "NB", label: "New Brunswick" },
  { code: "NL", label: "Newfoundland and Labrador" },
  { code: "NS", label: "Nova Scotia" },
  { code: "NT", label: "Northwest Territories" },
  { code: "NU", label: "Nunavut" },
  { code: "ON", label: "Ontario" },
  { code: "PE", label: "Prince Edward Island" },
  { code: "QC", label: "Quebec" },
  { code: "SK", label: "Saskatchewan" },
  { code: "YT", label: "Yukon" },
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
  confidence_label?: "high" | "medium" | "low";
  sample_count: number;
  estimate_source?: "historical_exact" | "historical_relaxed" | "live_cohort" | "category_prior" | "none";
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
  posted_at?: string | null;
  distance_km?: number | null;
  distance_is_approximate?: boolean;
  vehicle_mileage_km?: number | null;
  score?: number;
  score_reason?: string | null;
  valuation?: Valuation | null;
  risk?: Risk | null;
};

type ResolvedLocation = {
  display_name: string;
  city: string;
  province_code: string;
  province_name: string;
  country_code: string;
  latitude: number;
  longitude: number;
  mode: "manual" | "gps";
};

type LocationResolveRequest = {
  city?: string;
  province?: string;
  latitude?: number;
  longitude?: number;
};

type LocationCitySuggestion = {
  city: string;
  province_code: string;
  province_name: string;
  display_name: string;
};

type LocationPersistence = "browser" | "account";

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
  new_count: number;
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

type CopilotConversationPayload = {
  role: "user" | "assistant";
  content: string;
};

type CopilotWindowRect = {
  width: number;
  height: number;
  x: number;
  y: number;
};

type CopilotLauncherPosition = {
  x: number;
  y: number;
};

type CopilotResizeDirection =
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";

type CopilotMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  answer?: string;
  seller_questions?: string[];
  red_flags?: string[];
  available?: boolean;
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
type SavedSearchResultBucket = { items: Listing[] };
type InterleavedSavedSearchBucketResult = {
  orderedItems: Listing[];
  seenKeys: Set<string>;
  nextLaneStart: number;
};

function isSourceOption(value: string): value is SourceOption {
  return SOURCE_OPTIONS.includes(value as SourceOption);
}

function isResolvedLocation(value: unknown): value is ResolvedLocation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ResolvedLocation>;
  return (
    typeof candidate.display_name === "string" &&
    typeof candidate.city === "string" &&
    typeof candidate.province_code === "string" &&
    typeof candidate.province_name === "string" &&
    typeof candidate.country_code === "string" &&
    typeof candidate.latitude === "number" &&
    typeof candidate.longitude === "number" &&
    (candidate.mode === "manual" || candidate.mode === "gps")
  );
}

function readStoredResolvedLocation(): ResolvedLocation | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SEARCH_LOCATION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isResolvedLocation(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredResolvedLocation(location: ResolvedLocation | null) {
  if (typeof window === "undefined") return;
  if (location) {
    window.localStorage.setItem(SEARCH_LOCATION_STORAGE_KEY, JSON.stringify(location));
    return;
  }
  window.localStorage.removeItem(SEARCH_LOCATION_STORAGE_KEY);
}

function toLocationResolveRequest(location: ResolvedLocation): LocationResolveRequest {
  if (location.mode === "gps") {
    return {
      latitude: location.latitude,
      longitude: location.longitude,
    };
  }
  return {
    city: location.city,
    province: location.province_code,
  };
}

function formatPrice(price?: Money | null) {
  if (!price) return "-";
  return `${price.currency} ${price.amount}`;
}

function formatMoneyCompact(amount?: number | null, currency = "CAD") {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  return `${currency} ${Math.round(amount)}`;
}

function formatVehicleMileageKm(vehicleMileageKm?: number | null) {
  if (typeof vehicleMileageKm !== "number" || !Number.isFinite(vehicleMileageKm)) return null;
  return `${Math.round(vehicleMileageKm).toLocaleString()} km`;
}

const AUTOMOTIVE_MARKER_RE =
  /\b(?:acura|audi|bmw|buick|cadillac|chevrolet|chevy|chrysler|dodge|ford|gmc|honda|hyundai|infiniti|jeep|kia|lexus|lincoln|mazda|mercedes(?:-benz)?|mini|mitsubishi|nissan|porsche|ram|subaru|tesla|toyota|volkswagen|vw|volvo|car|cars|truck|trucks|suv|sedan|coupe|hatchback|wagon|pickup|minivan|van|crossover|automotive|vehicle|vehicles)\b/i;
const AUTOMOTIVE_YEAR_RE = /\b(?:19[5-9]\d|20[0-3]\d)\b/;
const VEHICLE_MILEAGE_RE =
  /(\d{1,3}(?:[.,]\d{1,2})?|\d{1,3}(?:[,\s]\d{3})+|\d{4,7})(?:\s*([kKmM]))?\s*(?:km|kms|kilomet(?:er|re)s?)\b/gi;

function parseVehicleMileageKm(text: string) {
  const matcher = new RegExp(VEHICLE_MILEAGE_RE.source, VEHICLE_MILEAGE_RE.flags);
  let match: RegExpExecArray | null = null;

  while ((match = matcher.exec(text)) !== null) {
    const rawValue = match[1];
    if (!rawValue) continue;

    const previousChar = match.index > 0 ? text[match.index - 1] : "";
    if (/[.\d]/.test(previousChar)) continue;

    const trailingText = text.slice(match.index + match[0].length);
    if (/^\s*away\b/i.test(trailingText)) continue;

    const scale = match[2]?.toLowerCase();
    const normalizedValue =
      scale && rawValue.includes(".")
        ? rawValue.replace(/,/g, "").replace(/\s/g, "")
        : scale
          ? rawValue.replace(",", ".").replace(/\s/g, "")
          : rawValue.replace(/[,\s]/g, "");
    const parsed = Number(normalizedValue);
    if (!Number.isFinite(parsed)) continue;

    if (scale === "k") return parsed * 1_000;
    if (scale === "m") return parsed * 1_000_000;
    return parsed;
  }

  return null;
}

function inferVehicleMileageKm(item: Pick<Listing, "title" | "snippet" | "vehicle_mileage_km">) {
  if (typeof item.vehicle_mileage_km === "number" && Number.isFinite(item.vehicle_mileage_km)) {
    return item.vehicle_mileage_km;
  }

  const automotiveText = [item.title, item.snippet].filter(Boolean).join(" ");
  if (!automotiveText) return null;
  if (!AUTOMOTIVE_MARKER_RE.test(automotiveText) && !AUTOMOTIVE_YEAR_RE.test(automotiveText)) {
    return null;
  }

  return parseVehicleMileageKm(automotiveText);
}

function getListingKey(item: Listing): string {
  return `${item.source}:${item.source_listing_id || item.url}`;
}

function buildCopilotListingContext(item: Listing) {
  return {
    listing_key: getListingKey(item),
    source: item.source,
    source_listing_id: item.source_listing_id,
    title: item.title,
    price: item.price ?? null,
    url: item.url,
    condition: item.condition ?? null,
    location: item.location ?? null,
    snippet: item.snippet ?? null,
    score: item.score ?? null,
    score_reason: item.score_reason ?? null,
    valuation: item.valuation ?? null,
    risk: item.risk ?? null,
  };
}

function createCopilotMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildAssistantConversationContent(response: CopilotResponse) {
  const sections = [response.answer.trim()];

  if (response.seller_questions.length > 0) {
    sections.push(
      `Seller questions:\n${response.seller_questions.map((entry) => `- ${entry}`).join("\n")}`,
    );
  }

  if (response.red_flags.length > 0) {
    sections.push(`Red flags:\n${response.red_flags.map((entry) => `- ${entry}`).join("\n")}`);
  }

  return sections.filter(Boolean).join("\n\n");
}

function clampNumber(value: number, min: number, max: number) {
  if (min > max) return min;
  return Math.min(max, Math.max(min, value));
}

function getDefaultCopilotWindowRect(
  viewportWidth: number,
  viewportHeight: number,
  widthOverride = COPILOT_WINDOW_WIDTH_DEFAULT,
): CopilotWindowRect {
  const maxWidth = Math.max(COPILOT_WINDOW_WIDTH_MIN, viewportWidth - COPILOT_FLOATING_MARGIN * 2);
  const maxHeight = Math.max(COPILOT_WINDOW_HEIGHT_MIN, viewportHeight - COPILOT_FLOATING_MARGIN * 2);
  const width = clampNumber(widthOverride, COPILOT_WINDOW_WIDTH_MIN, maxWidth);
  const height = clampNumber(COPILOT_WINDOW_HEIGHT_DEFAULT, COPILOT_WINDOW_HEIGHT_MIN, maxHeight);
  return {
    width,
    height,
    x: Math.max(COPILOT_FLOATING_MARGIN, viewportWidth - width - COPILOT_FLOATING_MARGIN),
    y: Math.max(COPILOT_FLOATING_MARGIN, viewportHeight - height - COPILOT_FLOATING_MARGIN),
  };
}

function clampCopilotWindowRect(
  rect: CopilotWindowRect,
  viewportWidth: number,
  viewportHeight: number,
) {
  const maxWidth = Math.max(COPILOT_WINDOW_WIDTH_MIN, viewportWidth - COPILOT_FLOATING_MARGIN * 2);
  const maxHeight = Math.max(COPILOT_WINDOW_HEIGHT_MIN, viewportHeight - COPILOT_FLOATING_MARGIN * 2);
  const width = clampNumber(rect.width, COPILOT_WINDOW_WIDTH_MIN, maxWidth);
  const height = clampNumber(rect.height, COPILOT_WINDOW_HEIGHT_MIN, maxHeight);
  const x = clampNumber(
    rect.x,
    COPILOT_FLOATING_MARGIN,
    Math.max(COPILOT_FLOATING_MARGIN, viewportWidth - width - COPILOT_FLOATING_MARGIN),
  );
  const y = clampNumber(
    rect.y,
    COPILOT_FLOATING_MARGIN,
    Math.max(COPILOT_FLOATING_MARGIN, viewportHeight - height - COPILOT_FLOATING_MARGIN),
  );
  return { width, height, x, y };
}

function getDefaultCopilotLauncherPosition(viewportWidth: number, viewportHeight: number) {
  return {
    x: Math.max(COPILOT_FLOATING_MARGIN, viewportWidth - COPILOT_LAUNCHER_WIDTH - COPILOT_FLOATING_MARGIN),
    y: Math.max(COPILOT_FLOATING_MARGIN, viewportHeight - COPILOT_LAUNCHER_HEIGHT - COPILOT_FLOATING_MARGIN),
  };
}

function clampCopilotLauncherPosition(
  position: CopilotLauncherPosition,
  viewportWidth: number,
  viewportHeight: number,
) {
  return {
    x: clampNumber(
      position.x,
      COPILOT_FLOATING_MARGIN,
      Math.max(
        COPILOT_FLOATING_MARGIN,
        viewportWidth - COPILOT_LAUNCHER_WIDTH - COPILOT_FLOATING_MARGIN,
      ),
    ),
    y: clampNumber(
      position.y,
      COPILOT_FLOATING_MARGIN,
      Math.max(
        COPILOT_FLOATING_MARGIN,
        viewportHeight - COPILOT_LAUNCHER_HEIGHT - COPILOT_FLOATING_MARGIN,
      ),
    ),
  };
}

function sortListingsLocal(listings: Listing[], sort: SortOption): Listing[] {
  if (sort === "relevance") {
    return [...listings];
  }

  const indexed = listings.map((item, index) => ({ item, index }));
  const postedAtTimestamp = (value: string | null | undefined) => {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

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

  if (sort === "newest") {
    indexed.sort((a, b) => {
      const aTimestamp = postedAtTimestamp(a.item.posted_at);
      const bTimestamp = postedAtTimestamp(b.item.posted_at);
      const aMissing = aTimestamp === null;
      const bMissing = bTimestamp === null;
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      if (aTimestamp !== null && bTimestamp !== null && aTimestamp !== bTimestamp) {
        return bTimestamp - aTimestamp;
      }
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

function formatNewListingsCount(count: number) {
  return `${count} new ${count === 1 ? "listing" : "listings"}`;
}

function getSavedSearchAlertStatus(entry: SavedSearch) {
  if (!entry.alerts_enabled) {
    return "Alerts off";
  }

  if (!entry.last_alert_checked_at) {
    return "Waiting for first alert check. The first check sets your baseline.";
  }

  const lastChecked = formatTimestamp(entry.last_alert_checked_at);
  if (!entry.last_alert_notified_at) {
    return `Last checked ${lastChecked}. No new listings since your baseline.`;
  }

  return `Last checked ${lastChecked}. Last alert ${formatTimestamp(entry.last_alert_notified_at)}.`;
}

function normalizeNotificationError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (!message) return fallback;
  if (/failed to fetch|load failed|networkerror/i.test(message)) {
    return fallback;
  }
  return message;
}

function isLikelyNetworkError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /failed to fetch|load failed|networkerror/i.test(error.message);
}

const COPILOT_MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => (
    <p className="mt-3 text-sm leading-relaxed text-zinc-100 first:mt-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-zinc-100 first:mt-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-zinc-100 first:mt-0">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-emerald-200 underline underline-offset-2 transition hover:text-emerald-100"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-zinc-100">{children}</em>,
  code: ({ children }) => (
    <code className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[0.9em] text-zinc-100">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-zinc-100 first:mt-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-3 border-l-2 border-white/15 pl-4 text-sm text-zinc-300 first:mt-0">
      {children}
    </blockquote>
  ),
};

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
  locationProvince: string;
  setLocationProvince: React.Dispatch<React.SetStateAction<string>>;
  locationCityInput: string;
  setLocationCityInput: React.Dispatch<React.SetStateAction<string>>;
  currentLocation: ResolvedLocation | null;
  locationPersistence: LocationPersistence | null;
  locationSuggestions: LocationCitySuggestion[];
  onApplyManualLocation: () => Promise<void>;
  onUseMyLocation: () => void;
  onClearLocation: () => Promise<void>;
  locationBusy: boolean;
  locationError: string | null;
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
  openCopilot: () => void;
  closeCopilot: () => void;
  copilotQuestion: string;
  setCopilotQuestion: React.Dispatch<React.SetStateAction<string>>;
  copilotLoading: boolean;
  copilotError: string | null;
  copilotMessages: CopilotMessage[];
  latestShortlist: CopilotShortlistItem[];
  copilotSelectionMode: boolean;
  toggleCopilotSelectionMode: () => void;
  copilotSelectedListingKeys: string[];
  clearCopilotSelection: () => void;
  removeListingFromCopilotSelection: (listingKey: string) => void;
  onToggleListingSelection: (item: Listing) => void;
  resetCopilotConversation: () => void;
  copilotWindowRect: CopilotWindowRect;
  copilotLauncherPosition: CopilotLauncherPosition;
  onCopilotLauncherDragStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onCopilotWindowDragStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onCopilotResizeStart: (
    direction: CopilotResizeDirection,
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
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
  | "locationProvince"
  | "setLocationProvince"
  | "locationCityInput"
  | "setLocationCityInput"
  | "currentLocation"
  | "locationPersistence"
  | "locationSuggestions"
  | "onApplyManualLocation"
  | "onUseMyLocation"
  | "onClearLocation"
  | "locationBusy"
  | "locationError"
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
  | "sentinelRef"
  | "loadingMore"
  | "hasMore"
  | "copilotSelectionMode"
  | "copilotSelectedListingKeys"
  | "onToggleListingSelection"
>;

function SearchPageView(props: SearchPageViewProps) {
  const heroQuery = props.q.trim();
  const heroTitle =
    heroQuery || (props.hasSearched ? "Unified results" : "All marketplaces. One search.");
  const showLiveHeroCopy = heroQuery.length > 0 || props.hasSearched;
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(`(min-width: ${COPILOT_DESKTOP_BREAKPOINT}px)`);
    const sync = () => setIsDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

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
          </div>

          <div className="flex items-center gap-2">

            <AlertsRail {...props} />

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
                  ? "Compare live listings across Kijiji, eBay, and Facebook Marketplace in a single feed."
                  : "Run a search, choose sources, and browse a unified marketplace grid with saved searches and infinite scroll."}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {(props.summarySources.length > 0 ? props.summarySources : props.sources).map((source) => (
                  <SourceChip key={`hero-source-${source}`} source={source} compact />
                ))}
                {props.hasActiveClientFilters ? (
                  <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">
                    Location ranking active
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
                sub={props.hasActiveClientFilters ? "Nearby results ranked first" : "No location ranking"}
              />
              <StatTile label="Sources" value={String((props.summarySources.length > 0 ? props.summarySources : props.sources).length)} sub="Selected" />
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

      {!props.copilotOpen ? (
        <button
          type="button"
          onClick={props.openCopilot}
          onPointerDown={isDesktop ? props.onCopilotLauncherDragStart : undefined}
          className={cn(
            "fixed z-50 inline-flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-[24px] border border-white/10 bg-zinc-950/90 px-5 py-4 text-left text-zinc-100 shadow-2xl backdrop-blur-xl transition hover:border-white/20 hover:bg-zinc-950 sm:max-w-[calc(100vw-3rem)]",
            isDesktop ? "" : "bottom-4 right-4 sm:bottom-6 sm:right-6",
          )}
          style={
            isDesktop
              ? {
                  left: props.copilotLauncherPosition.x,
                  top: props.copilotLauncherPosition.y,
                  width: COPILOT_LAUNCHER_WIDTH,
                  minHeight: COPILOT_LAUNCHER_HEIGHT,
                }
              : undefined
          }
        >
          <div className="rounded-full border border-white/10 bg-white/[0.02] p-2.5 text-zinc-200">
            <Bot className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight text-white">Copilot</p>
            <p className="mt-0.5 text-xs text-zinc-400">
              {isDesktop ? "Drag me anywhere" : "Ask about these listings"}
            </p>
          </div>
        </button>
      ) : null}

      <CopilotWindow {...props} />
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
              Your location
            </label>
            <select
              className="w-full rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm text-zinc-100 focus:border-white/20 focus:outline-none"
              value={props.locationProvince}
              onChange={(e) => props.setLocationProvince(e.target.value)}
            >
              <option value="" className="bg-black text-white">
                Select province
              </option>
              {PROVINCE_OPTIONS.map((province) => (
                <option key={province.code} value={province.code} className="bg-black text-white">
                  {province.label}
                </option>
              ))}
            </select>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
              <input
                list="marketly-location-suggestions"
                className="w-full rounded-xl border border-white/10 bg-white/[0.02] py-2.5 pl-9 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-white/20 focus:outline-none"
                value={props.locationCityInput}
                onChange={(e) => props.setLocationCityInput(e.target.value)}
                placeholder="City in Canada"
              />
            </div>
            <datalist id="marketly-location-suggestions">
              {props.locationSuggestions.map((suggestion) => (
                <option key={suggestion.display_name} value={suggestion.city}>
                  {suggestion.display_name}
                </option>
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => void props.onApplyManualLocation()}
              disabled={props.locationBusy || !props.locationProvince || !props.locationCityInput.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-3 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {props.locationBusy ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
              {props.locationBusy ? "Saving..." : "Set location"}
            </button>
            <button
              type="button"
              onClick={props.onUseMyLocation}
              disabled={props.locationBusy}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm text-zinc-100 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {props.locationBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LocateFixed className="size-4" />
              )}
              {props.locationBusy ? "Locating..." : "Use GPS"}
            </button>

            <button
              type="button"
              onClick={() => void props.onClearLocation()}
              disabled={props.locationBusy && !props.currentLocation}
              className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear
            </button>
          </div>

          {props.sources.length === 0 ? (
            <p className="text-xs text-red-300">Select at least one source to search.</p>
          ) : null}
          {props.locationError ? (
            <p className="text-xs text-red-300">{props.locationError}</p>
          ) : null}
          {props.currentLocation ? (
            <p className="text-xs text-zinc-400">
              Nearby Kijiji and Facebook listings will rank first.
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
            Saved searches can auto-load a multi-query feed and power saved search alerts.
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
                  <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                    {getSavedSearchAlertStatus(entry)}
                  </p>
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
  const showUnreadDot = unreadCount > 0;

  return (
    <details className="relative">
      <summary className="relative flex cursor-pointer list-none items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden">
        <BellRing className="size-4 text-zinc-300" />
        <span className="hidden sm:inline">Alerts</span>
        {showUnreadDot ? (
          <span className="absolute right-2 top-2 size-2 rounded-full bg-red-500 ring-2 ring-black" />
        ) : null}
      </summary>

      <div className="absolute right-0 z-50 mt-2 w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
              Alerts
            </p>
            <span className="rounded-full border border-white/10 bg-white/[0.02] px-2.5 py-1 text-[11px] text-zinc-300">
              {unreadCount} unread
            </span>
          </div>

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

        {props.notificationsError ? (
          <div className="mb-3 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">
            {props.notificationsError}
          </div>
        ) : null}

        {!props.user ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4">
            <p className="text-sm text-zinc-300">
              {props.authLoading ? "Checking your account..." : "Log in to receive saved search alerts."}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Alerts appear when Marketly finds new listings for one of your alert-enabled saved searches.
            </p>
          </div>
        ) : props.notifications.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4">
            <p className="text-sm text-zinc-300">No saved search alerts yet.</p>
            <p className="mt-1 text-xs text-zinc-500">
              Enable alerts on a saved search and new-listing alerts will show up here.
            </p>
          </div>
        ) : (
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
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
                      {notification.saved_search_query}
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {formatNewListingsCount(notification.new_count)} | {formatTimestamp(notification.created_at)}
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
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
  sentinelRef,
  loadingMore,
  hasMore,
  copilotSelectionMode,
  copilotSelectedListingKeys,
  onToggleListingSelection,
}: ResultsPanelProps) {
  const selectedListingKeys = useMemo(
    () => new Set(copilotSelectedListingKeys),
    [copilotSelectedListingKeys],
  );

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

      {searchLoading && results.length === 0 ? <ListingsLoadingState /> : null}

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
                ? "No listings are available for the selected location ranking."
                : "No results found for this search."}
            </GlassPanel>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredResults.map((item) => {
                const cardKey = `${item.source}:${item.source_listing_id || item.url}`;
                return (
                  <MarketplaceResultCard
                    key={cardKey}
                    item={item}
                    selectionMode={copilotSelectionMode}
                    copilotSelected={selectedListingKeys.has(cardKey)}
                    onToggleSelection={onToggleListingSelection}
                  />
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
      <div className="relative aspect-[4/3] bg-zinc-900">
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

function ListingsLoadingState() {
  return (
    <div className="flex min-h-[420px] items-center justify-center bg-black sm:min-h-[520px]">
      <div className="flex flex-col items-center justify-center">
        <div className="w-full max-w-[340px] sm:max-w-[700px]">
          <DotLottieReact
            src="https://lottie.host/729f73c3-4888-46ac-8dfc-ec1f5a93a4ab/EXocOBWnmK.lottie"
            loop
            autoplay
          />
        </div>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">
          Loading Listings
        </p>
        <Loader2 className="mt-3 size-9 animate-spin text-zinc-300" aria-hidden="true" />
      </div>
    </div>
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
              <p className="text-sm font-medium text-zinc-100">Saved search alerts</p>
              <p className="text-xs text-zinc-500">Let me know when new listings appear for this search.</p>
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
  const label = formatSourceLabel(source) || source;
  const logo = getMarketplaceLogoMeta(source);
  const content = logo ? (
    <Image
      src={logo.src}
      alt={logo.alt}
      width={logo.width}
      height={logo.height}
      className={cn(
        "w-auto shrink-0",
        compact ? logo.compactChipClassName : logo.chipClassName,
      )}
    />
  ) : (
    <>
      <span className={cn("size-1.5 rounded-full", tone.dot)} />
      <span>{label}</span>
    </>
  );

  const classes = cn(
    "inline-flex items-center justify-center gap-2 rounded-full border font-medium transition",
    compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-sm",
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
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

  return (
    <span className={cn(classes, tone.border, tone.bg, tone.text)} title={label}>
      {content}
    </span>
  );
}

function getMarketplaceLogoMeta(source: string): {
  src: string;
  alt: string;
  width: number;
  height: number;
  chipClassName?: string;
  compactChipClassName?: string;
  badgeClassName?: string;
} | null {
  const normalized = source.toLowerCase();

  if (normalized.includes("facebook")) {
    return {
      src: "/marketplaces/facebook_logo.svg",
      alt: "Facebook Marketplace",
      width: 190,
      height: 36,
      chipClassName: "h-3.5 max-w-[74px]",
      compactChipClassName: "h-3 max-w-[64px]",
      badgeClassName: "h-3.5 max-w-[84px]",
    };
  }

  if (normalized.includes("ebay")) {
    return {
      src: "/marketplaces/EBay_logo.svg",
      alt: "eBay",
      width: 150,
      height: 44,
      chipClassName: "h-3.5 max-w-[52px]",
      compactChipClassName: "h-3 max-w-[44px]",
      badgeClassName: "h-3.5 max-w-[60px]",
    };
  }

  if (normalized.includes("kijiji")) {
    return {
      src: "/marketplaces/kijiji_logo.svg",
      alt: "Kijiji",
      width: 360,
      height: 120,
      chipClassName: "h-4 max-w-[48px]",
      compactChipClassName: "h-3.5 max-w-[42px]",
      badgeClassName: "h-4 max-w-[84px]",
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
        className={cn("w-auto opacity-95", logo.badgeClassName)}
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
  const toneClasses = insightPillToneClasses(tone);

  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", toneClasses)}>
      {label}
    </span>
  );
}

function insightPillToneClasses(tone: "emerald" | "amber" | "red" | "slate") {
  return {
    emerald: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
    amber: "border-amber-300/25 bg-amber-300/10 text-amber-100",
    red: "border-red-300/25 bg-red-400/10 text-red-100",
    slate: "border-white/10 bg-white/[0.03] text-zinc-300",
  }[tone];
}

function valuationTone(valuation?: Valuation | null): "emerald" | "amber" | "red" | "slate" {
  if (!valuation) return "slate";
  if (valuation.verdict === "underpriced") return "emerald";
  if (valuation.verdict === "overpriced") return "red";
  if (valuation.verdict === "fair") return "amber";
  return "slate";
}

function hasValuationBand(valuation?: Valuation | null) {
  return valuation?.estimated_low != null && valuation?.estimated_high != null;
}

function valuationLabel(valuation?: Valuation | null) {
  if (!valuation) return null;
  if (valuation.verdict === "insufficient_data") {
    return hasValuationBand(valuation) ? "Value: rough estimate" : "Value: pending";
  }
  return `Value: ${valuation.verdict.replace("_", " ")}`;
}

function valuationTooltipLines(valuation?: Valuation | null) {
  if (!valuation) return null;

  const lines: string[] = [];
  const explanation = valuation.explanation?.trim();
  if (explanation) {
    lines.push(explanation);
  }

  const estimateLow = formatMoneyCompact(valuation.estimated_low, valuation.currency);
  const estimateHigh = formatMoneyCompact(valuation.estimated_high, valuation.currency);
  if (estimateLow && estimateHigh) {
    lines.push(`Estimated range ${estimateLow} - ${estimateHigh}`);
  }

  return lines.length > 0 ? lines : null;
}

function formatDistanceKm(distanceKm?: number | null, approximate = false) {
  if (typeof distanceKm !== "number" || !Number.isFinite(distanceKm)) return null;
  if (distanceKm < 10) {
    const preciseDistanceKm = Number(distanceKm.toFixed(1));
    if (preciseDistanceKm === 0) return "Nearby";
    return `${approximate ? "~" : ""}${preciseDistanceKm.toFixed(1)} km away`;
  }
  return `${approximate ? "~" : ""}${Math.round(distanceKm)} km away`;
}

function ListingCardBody({
  item,
  titleClassName,
  allowTooltipFocus = true,
}: {
  item: Listing;
  titleClassName?: string;
  allowTooltipFocus?: boolean;
}) {
  const imageUrl = item.image_urls?.[0];
  const distanceLabel = formatDistanceKm(item.distance_km, item.distance_is_approximate);
  const vehicleMileageLabel = formatVehicleMileageKm(inferVehicleMileageKm(item));
  const footerLabel = vehicleMileageLabel ?? item.condition?.toUpperCase() ?? null;
  const valuationLabelText = valuationLabel(item.valuation) ?? "Value: pending";
  const valuationTooltipText = valuationTooltipLines(item.valuation);
  const valuationToneValue = valuationTone(item.valuation);

  return (
    <>
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

      <div className="flex min-h-[152px] flex-1 flex-col gap-2.5 overflow-hidden p-3.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-base font-semibold tracking-tight text-white">{formatPrice(item.price)}</p>
          {distanceLabel ? (
            <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-zinc-300">
              {distanceLabel}
            </span>
          ) : null}
        </div>

        <p
          className={cn(
            "line-clamp-2 text-sm font-medium leading-snug text-zinc-100 transition group-hover:text-white",
            titleClassName,
          )}
        >
          {item.title}
        </p>

        <p className="line-clamp-1 text-xs text-zinc-400">
          {item.location || `${formatSourceLabel(item.source)} listing`}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {item.valuation ? (
            valuationTooltipText ? (
              <TooltipProvider delayDuration={120}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        "inline-flex cursor-help rounded-full border px-2 py-0.5 text-[10px] font-medium outline-none",
                        allowTooltipFocus && "focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-0",
                        insightPillToneClasses(valuationToneValue),
                      )}
                      tabIndex={allowTooltipFocus ? 0 : -1}
                    >
                      {valuationLabelText}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    align="start"
                    className="max-w-64 border border-white/10 bg-zinc-950/95 px-3 py-2 text-[11px] leading-relaxed text-zinc-100 shadow-2xl"
                  >
                    <div className="space-y-1">
                      {valuationTooltipText.map((line) => (
                        <p key={line} className="text-zinc-200">
                          {line}
                        </p>
                      ))}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <InsightPill label={valuationLabelText} tone={valuationToneValue} />
            )
          ) : null}
        </div>

        <div className="mt-auto min-h-[16px]">
          {footerLabel ? (
            <p
              className={cn(
                "line-clamp-1 text-zinc-500",
                vehicleMileageLabel
                  ? "text-xs font-medium tracking-[0.02em] text-zinc-400"
                  : "text-[11px] uppercase tracking-[0.12em]",
              )}
            >
              {footerLabel}
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}

function MarketplaceResultCard({
  item,
  selectionMode,
  copilotSelected,
  onToggleSelection,
}: {
  item: Listing;
  selectionMode: boolean;
  copilotSelected: boolean;
  onToggleSelection: (item: Listing) => void;
}) {
  const content = <ListingCardBody item={item} allowTooltipFocus={!selectionMode} />;

  return (
    <li className="h-full">
      <article
        className={cn(
          "group flex h-full flex-col overflow-hidden rounded-2xl border bg-zinc-950/85 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-zinc-950",
          copilotSelected
            ? "border-emerald-300/50 shadow-[0_0_0_1px_rgba(110,231,183,0.35)_inset]"
            : "border-white/10",
        )}
      >
        {selectionMode ? (
          <button
            type="button"
            onClick={() => onToggleSelection(item)}
            className="flex flex-1 flex-col text-left"
            aria-pressed={copilotSelected}
          >
            {content}
          </button>
        ) : (
          <a href={item.url} target="_blank" rel="noreferrer" className="flex flex-1 flex-col">
            {content}
          </a>
        )}
      </article>
    </li>
  );
}

function CopilotShortlistCard({
  item,
  reason,
  selectionMode,
  copilotSelected,
  onToggleSelection,
}: {
  item: Listing;
  reason: string;
  selectionMode: boolean;
  copilotSelected: boolean;
  onToggleSelection: (item: Listing) => void;
}) {
  const body = (
    <div className="flex flex-1 flex-col">
      <ListingCardBody item={item} titleClassName="text-[15px]" allowTooltipFocus={!selectionMode} />
    </div>
  );

  return (
    <li className="h-full">
      <article
        className={cn(
          "group flex h-full flex-col overflow-hidden rounded-2xl border bg-zinc-950/85 transition hover:border-white/20 hover:bg-zinc-950",
          copilotSelected
            ? "border-emerald-300/50 shadow-[0_0_0_1px_rgba(110,231,183,0.35)_inset]"
            : "border-white/10",
        )}
      >
        {selectionMode ? (
          <button
            type="button"
            onClick={() => onToggleSelection(item)}
            className="flex flex-1 flex-col text-left"
            aria-pressed={copilotSelected}
          >
            {body}
          </button>
        ) : (
          body
        )}

        <div className="space-y-3 border-t border-white/10 p-3">
          <p className="text-xs leading-relaxed text-zinc-300">{reason}</p>
          <div className="grid grid-cols-1 gap-2">
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-zinc-200 transition hover:border-white/20 hover:bg-white/[0.05]"
            >
              <ArrowUpRight className="size-4" />
              Open listing
            </a>
          </div>
        </div>
      </article>
    </li>
  );
}

function CopilotTranscriptMessage({ message }: { message: CopilotMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl bg-white px-4 py-3 text-sm text-black">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-sm leading-relaxed text-zinc-100">
        <ReactMarkdown
          components={COPILOT_MARKDOWN_COMPONENTS}
          remarkPlugins={[remarkGfm, remarkBreaks]}
        >
          {(message.answer ?? message.content).replace(/\r\n/g, "\n")}
        </ReactMarkdown>
      </div>
      {message.seller_questions && message.seller_questions.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">
            Seller questions
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-zinc-300">
            {message.seller_questions.map((entry) => (
              <li key={entry}>- {entry}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {message.red_flags && message.red_flags.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">
            Red flags
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-zinc-300">
            {message.red_flags.map((entry) => (
              <li key={entry}>- {entry}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {!message.available && message.error_message ? (
        <p className="mt-3 text-xs text-zinc-500">{message.error_message}</p>
      ) : null}
    </div>
  );
}

function CopilotSelectedListingCard({
  item,
  onRemove,
}: {
  item: Listing;
  onRemove: (listingKey: string) => void;
}) {
  return (
    <li className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-100">{item.title}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {formatSourceLabel(item.source)} | {formatPrice(item.price)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onRemove(getListingKey(item))}
          className="rounded-full border border-white/10 bg-white/[0.02] p-1.5 text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.05]"
          aria-label={`Remove ${item.title} from copilot selection`}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

function CopilotWindow({
  activeQuery,
  filteredResults,
  copilotOpen,
  closeCopilot,
  copilotQuestion,
  setCopilotQuestion,
  copilotLoading,
  copilotError,
  copilotMessages,
  latestShortlist,
  copilotSelectionMode,
  toggleCopilotSelectionMode,
  copilotSelectedListingKeys,
  clearCopilotSelection,
  removeListingFromCopilotSelection,
  resetCopilotConversation,
  onToggleListingSelection,
  copilotWindowRect,
  onCopilotWindowDragStart,
  onCopilotResizeStart,
  onAskCopilot,
}: Pick<
  SearchPageViewProps,
  | "activeQuery"
  | "filteredResults"
  | "copilotOpen"
  | "closeCopilot"
  | "copilotQuestion"
  | "setCopilotQuestion"
  | "copilotLoading"
  | "copilotError"
  | "copilotMessages"
  | "latestShortlist"
  | "copilotSelectionMode"
  | "toggleCopilotSelectionMode"
  | "copilotSelectedListingKeys"
  | "clearCopilotSelection"
  | "removeListingFromCopilotSelection"
  | "resetCopilotConversation"
  | "onToggleListingSelection"
  | "copilotWindowRect"
  | "onCopilotWindowDragStart"
  | "onCopilotResizeStart"
  | "onAskCopilot"
>) {
  const listingMap = useMemo(
    () => new Map(filteredResults.map((item) => [getListingKey(item), item])),
    [filteredResults],
  );
  const scrollContentRef = useRef<HTMLDivElement | null>(null);
  const hasListings = filteredResults.length > 0;
  const selectedListings = useMemo(
    () =>
      copilotSelectedListingKeys
        .map((listingKey) => listingMap.get(listingKey) ?? null)
        .filter((item): item is Listing => item !== null),
    [copilotSelectedListingKeys, listingMap],
  );
  const hasSelectedListings = selectedListings.length > 0;
  const selectedListingKeySet = useMemo(
    () => new Set(copilotSelectedListingKeys),
    [copilotSelectedListingKeys],
  );
  const itemLabel = (() => {
    const trimmed = activeQuery.trim();
    if (!trimmed || trimmed.toLowerCase() === "saved searches") {
      return "this item";
    }
    return trimmed;
  })();
  const presets = hasListings || hasSelectedListings
    ? [
        "Which is the best value?",
        "What should I ask the seller?",
        "What are the red flags?",
      ]
    : [
        itemLabel === "this item"
          ? "What should I know before buying this item?"
          : `What should I know before buying ${itemLabel}?`,
        itemLabel === "this item"
          ? "What are the common issues to watch out for?"
          : `What are the common issues with ${itemLabel}?`,
        itemLabel === "this item"
          ? "What should I ask before buying one?"
          : `What should I ask before buying ${itemLabel}?`,
      ];
  const [showPresetPrompts, setShowPresetPrompts] = useState(true);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(`(min-width: ${COPILOT_DESKTOP_BREAKPOINT}px)`);
    const sync = () => setIsDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!scrollContentRef.current) return;
    scrollContentRef.current.scrollTop = scrollContentRef.current.scrollHeight;
  }, [copilotLoading, copilotMessages, copilotSelectedListingKeys.length, latestShortlist]);

  const handleAskCopilot = useCallback(
    (questionOverride?: string) => {
      const question = (questionOverride ?? copilotQuestion).trim();
      if (question) {
        setShowPresetPrompts(false);
      }
      void onAskCopilot(questionOverride);
    },
    [copilotQuestion, onAskCopilot],
  );

  const handleResetCopilotConversation = useCallback(() => {
    setShowPresetPrompts(true);
    resetCopilotConversation();
  }, [resetCopilotConversation]);

  if (!copilotOpen) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      <div
        className={cn(
          "pointer-events-auto absolute flex flex-col",
          isDesktop ? "" : "inset-4 sm:inset-6",
        )}
        style={
          isDesktop
            ? {
                width: copilotWindowRect.width,
                height: copilotWindowRect.height,
                left: copilotWindowRect.x,
                top: copilotWindowRect.y,
              }
            : undefined
        }
      >
        <GlassPanel className="relative flex h-full w-full min-h-0 flex-col overflow-hidden">
          <div className="border-b border-white/10 px-4 py-3">
            <div
              className={cn(
                "space-y-3",
                isDesktop ? "cursor-move select-none" : "",
              )}
              onPointerDown={isDesktop ? onCopilotWindowDragStart : undefined}
            >
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="rounded-full border border-white/10 bg-white/[0.02] p-2 text-zinc-300">
                    <Bot className="size-4" />
                  </div>
                  <p className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">Copilot</p>
                </div>
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={closeCopilot}
                  className="shrink-0 rounded-full border border-white/10 bg-white/[0.02] p-2 text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.05]"
                  aria-label="Close copilot"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={toggleCopilotSelectionMode}
                  className={cn(
                    "inline-flex whitespace-nowrap rounded-full border px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] transition",
                    copilotSelectionMode
                      ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
                      : "border-white/10 bg-white/[0.02] text-zinc-300 hover:border-white/20 hover:bg-white/[0.05]",
                  )}
                >
                  {copilotSelectionMode ? "Selecting listings" : "Select listings"}
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={handleResetCopilotConversation}
                  className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.02] px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.05]"
                >
                  <RefreshCw className="size-3.5" />
                  New chat
                </button>
              </div>
            </div>
          </div>

          <div
            ref={scrollContentRef}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
          >
            <div className="space-y-3">
              {copilotMessages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-4">
                  <p className="text-sm text-zinc-200">How can I help you today?</p>
                  <p className="mt-2 text-sm text-zinc-400">
                    Ask about any marketplace item, and when listings are loaded I can use them as live context for comparisons and listing-specific advice.
                  </p>
                </div>
              ) : (
                copilotMessages.map((message) => (
                  <CopilotTranscriptMessage key={message.id} message={message} />
                ))
              )}

              {copilotLoading ? (
                <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-300">
                  <Loader2 className="size-4 animate-spin" />
                  Thinking...
                </div>
              ) : null}
            </div>

            {(copilotSelectionMode || hasSelectedListings) && (
              <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                      Selected listings
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {hasSelectedListings
                        ? `${selectedListings.length} listing${selectedListings.length === 1 ? "" : "s"} will be used for the next copilot answer.`
                        : "Selection mode is on. Click result cards to add listings."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearCopilotSelection}
                    disabled={!hasSelectedListings}
                    className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Clear all
                  </button>
                </div>
                {hasSelectedListings ? (
                  <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {selectedListings.map((item) => (
                      <CopilotSelectedListingCard
                        key={getListingKey(item)}
                        item={item}
                        onRemove={removeListingFromCopilotSelection}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>
            )}

            {latestShortlist.length > 0 ? (
              <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Shortlist</p>
                  <span className="text-xs text-zinc-500">
                    {`${latestShortlist.length} listing${latestShortlist.length === 1 ? "" : "s"}`}
                  </span>
                </div>
                <ul className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {latestShortlist.map((entry) => {
                    const linkedListing = listingMap.get(entry.listing_key);
                    if (!linkedListing) {
                      return (
                        <li
                          key={entry.listing_key}
                          className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-sm text-zinc-300"
                        >
                          <p className="font-medium text-zinc-100">{entry.title}</p>
                          <p className="mt-1 text-xs text-zinc-400">{entry.reason}</p>
                        </li>
                      );
                    }

                    return (
                      <CopilotShortlistCard
                        key={entry.listing_key}
                        item={linkedListing}
                        reason={entry.reason}
                        selectionMode={copilotSelectionMode}
                        copilotSelected={selectedListingKeySet.has(entry.listing_key)}
                        onToggleSelection={onToggleListingSelection}
                      />
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="space-y-3 border-t border-white/10 bg-black/20 px-4 py-4">
            {showPresetPrompts ? (
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => handleAskCopilot(preset)}
                    disabled={copilotLoading}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="space-y-2">
              <textarea
                className="min-h-[112px] w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-white/20 focus:outline-none"
                placeholder={
                  hasSelectedListings
                    ? "Ask about the selected listings or the item itself..."
                    : hasListings
                      ? "Ask about this item or the current listings..."
                      : "Ask about any marketplace item..."
                }
                value={copilotQuestion}
                onChange={(event) => setCopilotQuestion(event.target.value)}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500">
                  {hasSelectedListings
                    ? `Uses ${Math.min(selectedListings.length, 25)} selected listing${selectedListings.length === 1 ? "" : "s"} from this search as live context.`
                    : hasListings
                      ? `Uses the top ${Math.min(filteredResults.length, 25)} visible listings from this search as live context.`
                      : "No listings are loaded yet. Ask about any marketplace item, or run a search to include live listings."}
                </p>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => handleAskCopilot()}
                  disabled={copilotLoading || !copilotQuestion.trim()}
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
          </div>
        </GlassPanel>

        {isDesktop && (
          <>
            <div
              className="absolute inset-y-0 -left-2 hidden w-4 cursor-ew-resize lg:block"
              onPointerDown={(event) => onCopilotResizeStart("w", event)}
              role="presentation"
            />
            <div
              className="absolute inset-y-0 -right-2 hidden w-4 cursor-ew-resize lg:block"
              onPointerDown={(event) => onCopilotResizeStart("e", event)}
              role="presentation"
            />
            <div
              className="absolute inset-x-0 -top-2 hidden h-4 cursor-ns-resize lg:block"
              onPointerDown={(event) => onCopilotResizeStart("n", event)}
              role="presentation"
            />
            <div
              className="absolute inset-x-0 -bottom-2 hidden h-4 cursor-ns-resize lg:block"
              onPointerDown={(event) => onCopilotResizeStart("s", event)}
              role="presentation"
            />
            <div
              className="absolute -left-2 -top-2 hidden size-4 cursor-nwse-resize lg:block"
              onPointerDown={(event) => onCopilotResizeStart("nw", event)}
              role="presentation"
            />
            <div
              className="absolute -right-2 -top-2 hidden size-4 cursor-nesw-resize lg:block"
              onPointerDown={(event) => onCopilotResizeStart("ne", event)}
              role="presentation"
            />
            <div
              className="absolute -left-2 -bottom-2 hidden size-4 cursor-nesw-resize lg:block"
              onPointerDown={(event) => onCopilotResizeStart("sw", event)}
              role="presentation"
            />
            <div
              className="absolute -bottom-2 -right-2 hidden size-4 cursor-nwse-resize lg:block"
              onPointerDown={(event) => onCopilotResizeStart("se", event)}
              role="presentation"
            />
          </>
        )}
      </div>
    </div>
  );
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
  const [locationProvince, setLocationProvince] = useState("");
  const [locationCityInput, setLocationCityInput] = useState("");
  const [currentLocation, setCurrentLocation] = useState<ResolvedLocation | null>(null);
  const [locationPersistence, setLocationPersistence] = useState<LocationPersistence | null>(null);
  const [locationSuggestions, setLocationSuggestions] = useState<LocationCitySuggestion[]>([]);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationHydrated, setLocationHydrated] = useState(false);
  const [accountLocationReady, setAccountLocationReady] = useState(false);

  const [editing, setEditing] = useState<SavedSearch | null>(null);
  const [editQuery, setEditQuery] = useState("");
  const [editSources, setEditSources] = useState<SourceOption[]>([]);
  const [editAlertsEnabled, setEditAlertsEnabled] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotQuestion, setCopilotQuestion] = useState("");
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [copilotMessages, setCopilotMessages] = useState<CopilotMessage[]>([]);
  const [latestShortlist, setLatestShortlist] = useState<CopilotShortlistItem[]>([]);
  const [copilotSelectionMode, setCopilotSelectionMode] = useState(false);
  const [copilotSelectedListingKeys, setCopilotSelectedListingKeys] = useState<string[]>([]);
  const [copilotWindowRect, setCopilotWindowRect] = useState<CopilotWindowRect>({
    width: COPILOT_WINDOW_WIDTH_DEFAULT,
    height: COPILOT_WINDOW_HEIGHT_DEFAULT,
    x: COPILOT_FLOATING_MARGIN,
    y: COPILOT_FLOATING_MARGIN,
  });
  const [copilotLauncherPosition, setCopilotLauncherPosition] = useState<CopilotLauncherPosition>({
    x: COPILOT_FLOATING_MARGIN,
    y: COPILOT_FLOATING_MARGIN,
  });
  const [facebookConfigStatus, setFacebookConfigStatus] = useState<FacebookConnectorStatus | null>(null);
  const [facebookConfigLoading, setFacebookConfigLoading] = useState(false);
  const [facebookConfigError, setFacebookConfigError] = useState<string | null>(null);
  const [facebookUploadBusy, setFacebookUploadBusy] = useState(false);
  const [facebookVerifyBusy, setFacebookVerifyBusy] = useState(false);
  const [facebookDeleteBusy, setFacebookDeleteBusy] = useState(false);
  const [facebookCookieJsonText, setFacebookCookieJsonText] = useState("");

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const currentLocationRef = useRef<ResolvedLocation | null>(null);
  const seenKeysRef = useRef<Set<string>>(new Set());
  const fetchInFlightRef = useRef(false);
  const autoLoadedSavedForUserRef = useRef<string | null>(null);
  const initializedLocationUserRef = useRef<string | null>(null);
  const savedBatchLaneStartRef = useRef(0);
  const copilotSessionVersionRef = useRef(0);
  const copilotLauncherDragMovedRef = useRef(false);

  const savedBatchHasMore =
    resultMode === "saved_batch" &&
    savedBatchPagination !== null &&
    savedBatchPagination.entries.some((entry) => entry.nextOffset !== null);
  const hasMore =
    hasSearched &&
    (resultMode === "saved_batch" ? savedBatchHasMore : nextOffset !== null);

  useEffect(() => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const legacyWidth = Number(window.localStorage.getItem(COPILOT_WINDOW_WIDTH_STORAGE_KEY));

    let nextRect = getDefaultCopilotWindowRect(
      viewportWidth,
      viewportHeight,
      Number.isFinite(legacyWidth) ? legacyWidth : COPILOT_WINDOW_WIDTH_DEFAULT,
    );
    const storedRect = window.localStorage.getItem(COPILOT_WINDOW_RECT_STORAGE_KEY);
    if (storedRect) {
      try {
        const parsed = JSON.parse(storedRect) as Partial<CopilotWindowRect>;
        if (
          typeof parsed.width === "number" &&
          typeof parsed.height === "number" &&
          typeof parsed.x === "number" &&
          typeof parsed.y === "number"
        ) {
          nextRect = clampCopilotWindowRect(
            {
              width: parsed.width,
              height: parsed.height,
              x: parsed.x,
              y: parsed.y,
            },
            viewportWidth,
            viewportHeight,
          );
        }
      } catch {
        // Ignore invalid persisted state.
      }
    }
    setCopilotWindowRect(nextRect);

    let nextLauncherPosition = getDefaultCopilotLauncherPosition(viewportWidth, viewportHeight);
    const storedLauncher = window.localStorage.getItem(COPILOT_LAUNCHER_POSITION_STORAGE_KEY);
    if (storedLauncher) {
      try {
        const parsed = JSON.parse(storedLauncher) as Partial<CopilotLauncherPosition>;
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          nextLauncherPosition = clampCopilotLauncherPosition(
            { x: parsed.x, y: parsed.y },
            viewportWidth,
            viewportHeight,
          );
        }
      } catch {
        // Ignore invalid persisted state.
      }
    }
    setCopilotLauncherPosition(nextLauncherPosition);
  }, []);

  useEffect(() => {
    const storedLocation = readStoredResolvedLocation();
    if (storedLocation) {
      currentLocationRef.current = storedLocation;
      setCurrentLocation(storedLocation);
      setLocationPersistence("browser");
      setLocationProvince(storedLocation.province_code);
      setLocationCityInput(storedLocation.city);
    }
    setLocationHydrated(true);
    setAccountLocationReady(false);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(COPILOT_WINDOW_RECT_STORAGE_KEY, JSON.stringify(copilotWindowRect));
  }, [copilotWindowRect]);

  useEffect(() => {
    window.localStorage.setItem(
      COPILOT_LAUNCHER_POSITION_STORAGE_KEY,
      JSON.stringify(copilotLauncherPosition),
    );
  }, [copilotLauncherPosition]);

  useEffect(() => {
    const handleResize = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      setCopilotWindowRect((prev) =>
        clampCopilotWindowRect(prev, viewportWidth, viewportHeight),
      );
      setCopilotLauncherPosition((prev) =>
        clampCopilotLauncherPosition(prev, viewportWidth, viewportHeight),
      );
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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

  const filteredResults = results;

  useEffect(() => {
    const visibleKeys = new Set(filteredResults.map((item) => getListingKey(item)));
    setCopilotSelectedListingKeys((prev) => {
      const next = prev.filter((listingKey) => visibleKeys.has(listingKey));
      return next.length === prev.length ? prev : next;
    });
  }, [filteredResults]);

  const resetCopilotConversation = useCallback(() => {
    copilotSessionVersionRef.current += 1;
    setCopilotQuestion("");
    setCopilotLoading(false);
    setCopilotError(null);
    setCopilotMessages([]);
    setLatestShortlist([]);
    setCopilotSelectionMode(false);
    setCopilotSelectedListingKeys([]);
  }, []);

  const hasActiveClientFilters = currentLocation !== null;
  const filteredOutCount = 0;

  const buildSearchUrl = useCallback(
    (
      query: string,
      selectedSources: SourceOption[],
      selectedSort: SortOption,
      selectedLimit: number,
      offset: number,
    ) => {
      const searchLocation = currentLocationRef.current;
      const params = new URLSearchParams();
      params.set("q", query);
      for (const source of selectedSources) {
        params.append("sources", source);
      }
      params.set("sort", selectedSort);
      params.set("limit", String(selectedLimit));
      params.set("offset", String(offset));
      if (searchLocation) {
        params.set("latitude", String(searchLocation.latitude));
        params.set("longitude", String(searchLocation.longitude));
      }
      return `${API_BASE}/search?${params.toString()}`;
    },
    [API_BASE],
  );

  const fetchWithRetry = useCallback(async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    try {
      return await fetch(input, init);
    } catch (error: unknown) {
      if (!isLikelyNetworkError(error)) {
        throw error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      return fetch(input, init);
    }
  }, []);

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
      const previousState = append
        ? null
        : {
            rawResults,
            results,
            nextOffset,
            total,
            sourceErrors,
            savedBatchPagination,
            hasSearched,
            resultMode,
            activeQuery,
            activeSources,
            activeSort,
            activeLimit,
            seenKeys: new Set(seenKeysRef.current),
          };

      if (append) {
        setLoadingMore(true);
      } else {
        setSearchLoading(true);
        setError(null);
        setCopilotError(null);
        setRawResults([]);
        setResults([]);
        setNextOffset(null);
        setTotal(null);
        setSourceErrors({});
        setSavedBatchPagination(null);
        seenKeysRef.current = new Set();
      }

      try {
        const url = buildSearchUrl(query, sourceList, selectedSort, selectedLimit, offset);
        const res = await fetchWithRetry(url, {
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
          resetCopilotConversation();
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
        if (previousState) {
          setRawResults(previousState.rawResults);
          setResults(previousState.results);
          setNextOffset(previousState.nextOffset);
          setTotal(previousState.total);
          setSourceErrors(previousState.sourceErrors);
          setSavedBatchPagination(previousState.savedBatchPagination);
          setHasSearched(previousState.hasSearched);
          setResultMode(previousState.resultMode);
          setActiveQuery(previousState.activeQuery);
          setActiveSources(previousState.activeSources);
          setActiveSort(previousState.activeSort);
          setActiveLimit(previousState.activeLimit);
          seenKeysRef.current = previousState.seenKeys;
        }
      } finally {
        if (append) {
          setLoadingMore(false);
        } else {
          setSearchLoading(false);
        }
        fetchInFlightRef.current = false;
      }
    },
    [
      accessToken,
      activeLimit,
      activeQuery,
      activeSort,
      activeSources,
      buildSearchUrl,
      fetchWithRetry,
      hasSearched,
      nextOffset,
      rawResults,
      resetCopilotConversation,
      resultMode,
      results,
      savedBatchPagination,
      sourceErrors,
      total,
    ],
  );

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

  const applyResolvedLocation = useCallback((location: ResolvedLocation | null) => {
    currentLocationRef.current = location;
    setCurrentLocation(location);
    setLocationProvince(location?.province_code ?? "");
    setLocationCityInput(location?.city ?? "");
    writeStoredResolvedLocation(location);
  }, []);

  const resolveLocationPayload = useCallback(async (
    payload: LocationResolveRequest,
  ): Promise<ResolvedLocation> => {
    const res = await fetchWithRetry(`${API_BASE}/location/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(await parseApiError(res, "Unable to resolve that Canadian location."));
    }
    return (await res.json()) as ResolvedLocation;
  }, [API_BASE, fetchWithRetry, parseApiError]);

  const fetchMyLocation = useCallback(async (): Promise<ResolvedLocation | null> => {
    if (!accessToken) return null;
    const res = await fetchWithRetry(`${API_BASE}/me/location`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(await parseApiError(res, "Failed to load your saved location."));
    }
    return (await res.json()) as ResolvedLocation | null;
  }, [API_BASE, accessToken, fetchWithRetry, parseApiError]);

  const syncLocationToAccount = useCallback(async (
    location: ResolvedLocation | null,
  ): Promise<ResolvedLocation | null> => {
    if (!accessToken) return location;

    if (location === null) {
      const res = await fetchWithRetry(`${API_BASE}/me/location`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(await parseApiError(res, "Failed to clear your account location."));
      }
      return null;
    }

    const res = await fetchWithRetry(`${API_BASE}/me/location`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(toLocationResolveRequest(location)),
    });
    if (!res.ok) {
      throw new Error(await parseApiError(res, "Failed to save your account location."));
    }
    return (await res.json()) as ResolvedLocation;
  }, [API_BASE, accessToken, fetchWithRetry, parseApiError]);

  useEffect(() => {
    if (!locationHydrated) return;
    if (!locationProvince) {
      setLocationSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams();
          params.set("province", locationProvince);
          params.set("limit", "20");
          if (locationCityInput.trim()) {
            params.set("q", locationCityInput.trim());
          }

          const res = await fetch(`${API_BASE}/location/cities?${params.toString()}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!res.ok) {
            throw new Error(await parseApiError(res, "Failed to load city suggestions."));
          }
          const payload = (await res.json()) as LocationCitySuggestion[];
          setLocationSuggestions(payload);
        } catch {
          if (!controller.signal.aborted) {
            setLocationSuggestions([]);
          }
        }
      })();
    }, 120);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [API_BASE, locationCityInput, locationHydrated, locationProvince, parseApiError]);

  useEffect(() => {
    if (!locationHydrated) return;
    if (!accessToken || !user?.id) {
      initializedLocationUserRef.current = null;
      setAccountLocationReady(true);
      return;
    }
    if (initializedLocationUserRef.current === user.id) return;

    initializedLocationUserRef.current = user.id;
    setAccountLocationReady(false);
    let cancelled = false;

    void (async () => {
      try {
        const accountLocation = await fetchMyLocation();
        if (cancelled) return;

        if (accountLocation) {
          applyResolvedLocation(accountLocation);
          setLocationPersistence("account");
          setLocationError(null);
        }
      } catch (error: unknown) {
        if (!cancelled && !currentLocationRef.current) {
          setLocationPersistence(null);
        }
      } finally {
        if (!cancelled) {
          setAccountLocationReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    applyResolvedLocation,
    fetchMyLocation,
    locationHydrated,
    user?.id,
  ]);

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

      const res = await fetchWithRetry(`${API_BASE}/saved-searches`, {
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

      const res = await fetchWithRetry(`${API_BASE}/me/notifications`, {
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
      setNotificationsError(
        normalizeNotificationError(
          err,
          "Unable to load saved search alerts right now. Please try again.",
        ),
      );
      return null;
    } finally {
      setNotificationsLoading(false);
    }
  }

  const fetchSavedSearchPage = useCallback(async (
    entry: SavedSearch | SavedBatchPaginationEntry,
    {
      selectedLimit,
      selectedSort,
      offset,
    }: {
      selectedLimit: number;
      selectedSort: SortOption;
      offset: number;
    },
  ): Promise<SearchResponse> => {
    if (!accessToken) throw new Error("Please log in again.");

    const params = new URLSearchParams();
    params.set("sort", selectedSort);
    params.set("limit", String(selectedLimit));
    params.set("offset", String(offset));
    const searchLocation = currentLocationRef.current;
    if (searchLocation) {
      params.set("latitude", String(searchLocation.latitude));
      params.set("longitude", String(searchLocation.longitude));
    }

    const res = await fetchWithRetry(`${API_BASE}/saved-searches/${entry.id}/run?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${entry.query} (${res.status}): ${text}`);
    }

    return (await res.json()) as SearchResponse;
  }, [API_BASE, accessToken, fetchWithRetry]);

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
      const failures: string[] = [];
      const mergedSourceErrors: Record<string, SourceErrorEntry> = {};
      const nextOffsetsById = new Map<number, number | null>();
      const dedupedIncoming: Listing[] = [];
      const incomingBuckets: SavedSearchResultBucket[] = [];

      for (const entry of pendingEntries) {
        try {
          const payload = await fetchSavedSearchPage(entry, {
            selectedLimit: savedBatchPagination.selectedLimit,
            selectedSort: savedBatchPagination.selectedSort,
            offset: entry.nextOffset ?? 0,
          });
          nextOffsetsById.set(entry.id, payload.next_offset ?? null);
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
        } catch (error: unknown) {
          failures.push(error instanceof Error ? error.message : "Unknown error");
          continue;
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

      if (pendingEntries.length > 0 && failures.length === pendingEntries.length) {
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
        setError(`Some saved searches failed to load more (${failures.length}/${pendingEntries.length}).`);
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

    const previousState = {
      rawResults,
      results,
      nextOffset,
      total,
      sourceErrors,
      savedBatchPagination,
      hasSearched,
      resultMode,
      activeSavedSearchId,
      activeQuery,
      activeSources,
      activeSort,
      activeLimit,
      seenKeys: new Set(seenKeysRef.current),
      laneStart: savedBatchLaneStartRef.current,
    };
    fetchInFlightRef.current = true;
    setSearchLoading(true);
    setLoadingMore(false);
    setError(null);
    resetCopilotConversation();
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
      const dedupedResults: Listing[] = [];
      const mergedSourceErrors: Record<string, SourceErrorEntry> = {};
      const seenKeys = new Set<string>();
      const failures: string[] = [];
      const paginationEntries: SavedBatchPaginationEntry[] = [];
      const initialBuckets: SavedSearchResultBucket[] = [];

      for (const entry of savedSearches) {
        try {
          const payload = await fetchSavedSearchPage(entry, {
            selectedLimit,
            selectedSort,
            offset: 0,
          });
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
        } catch (error: unknown) {
          failures.push(error instanceof Error ? error.message : "Unknown error");
          continue;
        }
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

      if (savedSearches.length > 0 && failures.length === savedSearches.length) {
        throw new Error(`Failed to auto-load saved searches: ${failures[0]}`);
      }

      if (failures.length > 0) {
        setError(`Some saved searches failed to load (${failures.length}/${savedSearches.length}).`);
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
      if (previousState.hasSearched) {
        setRawResults(previousState.rawResults);
        setResults(previousState.results);
        setNextOffset(previousState.nextOffset);
        setTotal(previousState.total);
        setSourceErrors(previousState.sourceErrors);
        setSavedBatchPagination(previousState.savedBatchPagination);
        setHasSearched(previousState.hasSearched);
        setResultMode(previousState.resultMode);
        setActiveSavedSearchId(previousState.activeSavedSearchId);
        setActiveQuery(previousState.activeQuery);
        setActiveSources(previousState.activeSources);
        setActiveSort(previousState.activeSort);
        setActiveLimit(previousState.activeLimit);
        seenKeysRef.current = previousState.seenKeys;
        savedBatchLaneStartRef.current = previousState.laneStart;
      }
    } finally {
      setSearchLoading(false);
      fetchInFlightRef.current = false;
    }
  }

  const rerunActiveSearchWithLocation = useCallback(async () => {
    if (!hasSearched) return;

    if (resultMode === "saved_batch") {
      await runAllSavedSearches(saved, {
        selectedSort: activeSort,
        selectedLimit: activeLimit,
      });
      return;
    }

    const query = activeQuery.trim() || q.trim();
    const sourceList = activeSources.length > 0 ? activeSources : sources;
    if (!query || sourceList.length === 0) return;

    await runSearch({
      query,
      sourceList,
      selectedSort: activeSort,
      selectedLimit: activeLimit,
      offset: 0,
      append: false,
    });
  }, [
    activeLimit,
    activeQuery,
    activeSort,
    activeSources,
    hasSearched,
    q,
    resultMode,
    runAllSavedSearches,
    runSearch,
    saved,
    sources,
  ]);

  async function onApplyManualLocation() {
    if (!locationProvince || !locationCityInput.trim()) {
      setLocationError("Select a province and city in Canada.");
      return;
    }

    setLocationBusy(true);
    setLocationError(null);
    try {
      const resolved = await resolveLocationPayload({
        city: locationCityInput.trim(),
        province: locationProvince,
      });
      applyResolvedLocation(resolved);
      setLocationPersistence("browser");

      if (accessToken) {
        try {
          const syncedLocation = await syncLocationToAccount(resolved);
          if (syncedLocation) {
            applyResolvedLocation(syncedLocation);
            setLocationPersistence("account");
          }
        } catch (error: unknown) {
          setLocationError(
            error instanceof Error
              ? `${error.message} Using the browser-saved location for now.`
              : "Failed to sync your account location. Using the browser-saved location for now.",
          );
        }
      }

      await rerunActiveSearchWithLocation();
    } catch (error: unknown) {
      setLocationError(
        error instanceof Error ? error.message : "Unable to set that Canadian location.",
      );
    } finally {
      setLocationBusy(false);
    }
  }

  function onUseMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationError("Browser location is not available.");
      return;
    }

    setLocationBusy(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void (async () => {
          try {
            const resolved = await resolveLocationPayload({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
            applyResolvedLocation(resolved);
            setLocationPersistence("browser");

            if (accessToken) {
              try {
                const syncedLocation = await syncLocationToAccount(resolved);
                if (syncedLocation) {
                  applyResolvedLocation(syncedLocation);
                  setLocationPersistence("account");
                }
              } catch (error: unknown) {
                setLocationError(
                  error instanceof Error
                    ? `${error.message} Using the browser-saved location for now.`
                    : "Failed to sync your account location. Using the browser-saved location for now.",
                );
              }
            }

            await rerunActiveSearchWithLocation();
          } catch (error: unknown) {
            setLocationError(
              error instanceof Error ? error.message : "Unable to resolve your current location.",
            );
          } finally {
            setLocationBusy(false);
          }
        })();
      },
      (geoError) => {
        setLocationError(geoError.message || "Unable to get your current location.");
        setLocationBusy(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5 * 60 * 1000,
      },
    );
  }

  async function onClearLocation() {
    setLocationBusy(true);
    setLocationError(null);
    try {
      applyResolvedLocation(null);
      setLocationPersistence(null);

      if (accessToken) {
        try {
          await syncLocationToAccount(null);
        } catch (error: unknown) {
          setLocationError(
            error instanceof Error
              ? `${error.message} The location was cleared in this browser only.`
              : "Failed to clear your account location. The location was cleared in this browser only.",
          );
        }
      }

      await rerunActiveSearchWithLocation();
    } finally {
      setLocationBusy(false);
    }
  }

  useEffect(() => {
    if (!accountLocationReady) return;
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
  }, [accessToken, accountLocationReady, user]);

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
      await fetchNotifications();
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

      setNotifications((prev) => prev.filter((entry) => entry.saved_search_id !== id));
      if (activeSavedSearchId === id) {
        setActiveSavedSearchId(null);
      }
      await fetchSavedSearches();
      await fetchNotifications();
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
    const currentSort = sortBy;
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

    const rerunForServerSortedResults =
      hasSearched && (currentSort === "newest" || nextSort === "newest");
    if (!rerunForServerSortedResults) {
      return;
    }

    if (resultMode === "saved_batch") {
      await runAllSavedSearches(saved, {
        selectedSort: nextSort,
        selectedLimit: activeLimit,
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
      await fetchNotifications();

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
      setNotificationsError(
        normalizeNotificationError(
          err,
          "Unable to update this alert right now. Please try again.",
        ),
      );
    }
  }

  const openCopilot = useCallback(() => {
    if (copilotLauncherDragMovedRef.current) {
      copilotLauncherDragMovedRef.current = false;
      return;
    }
    setCopilotOpen(true);
    setCopilotError(null);
  }, []);

  const closeCopilot = useCallback(() => {
    setCopilotOpen(false);
  }, []);

  const toggleCopilotSelectionMode = useCallback(() => {
    setCopilotSelectionMode((prev) => !prev);
  }, []);

  const clearCopilotSelection = useCallback(() => {
    setCopilotSelectedListingKeys([]);
  }, []);

  const removeListingFromCopilotSelection = useCallback((listingKey: string) => {
    setCopilotSelectedListingKeys((prev) => prev.filter((candidate) => candidate !== listingKey));
  }, []);

  const onToggleListingSelection = useCallback((item: Listing) => {
    const listingKey = getListingKey(item);
    setCopilotOpen(true);
    setCopilotError(null);
    setCopilotSelectedListingKeys((prev) =>
      prev.includes(listingKey)
        ? prev.filter((candidate) => candidate !== listingKey)
        : [...prev, listingKey],
    );
  }, []);

  const onCopilotLauncherDragStart = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (typeof window === "undefined" || window.innerWidth < COPILOT_DESKTOP_BREAKPOINT || event.button !== 0) {
        return;
      }

      event.preventDefault();
      copilotLauncherDragMovedRef.current = false;
      const startX = event.clientX;
      const startY = event.clientY;
      const startPosition = copilotLauncherPosition;
      const originalUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (
          !copilotLauncherDragMovedRef.current &&
          (Math.abs(moveEvent.clientX - startX) > 4 || Math.abs(moveEvent.clientY - startY) > 4)
        ) {
          copilotLauncherDragMovedRef.current = true;
        }
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        setCopilotLauncherPosition(
          clampCopilotLauncherPosition(
            {
              x: startPosition.x + (moveEvent.clientX - startX),
              y: startPosition.y + (moveEvent.clientY - startY),
            },
            viewportWidth,
            viewportHeight,
          ),
        );
      };

      const handlePointerUp = () => {
        document.body.style.userSelect = originalUserSelect;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [copilotLauncherPosition],
  );

  const onCopilotWindowDragStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (typeof window === "undefined" || window.innerWidth < COPILOT_DESKTOP_BREAKPOINT || event.button !== 0) {
        return;
      }

      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startRect = copilotWindowRect;
      const originalUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        setCopilotWindowRect(
          clampCopilotWindowRect(
            {
              ...startRect,
              x: startRect.x + (moveEvent.clientX - startX),
              y: startRect.y + (moveEvent.clientY - startY),
            },
            viewportWidth,
            viewportHeight,
          ),
        );
      };

      const handlePointerUp = () => {
        document.body.style.userSelect = originalUserSelect;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [copilotWindowRect],
  );

  const onCopilotResizeStart = useCallback(
    (direction: CopilotResizeDirection, event: React.PointerEvent<HTMLDivElement>) => {
      if (typeof window === "undefined" || window.innerWidth < COPILOT_DESKTOP_BREAKPOINT || event.button !== 0) {
        return;
      }

      event.stopPropagation();
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startRect = copilotWindowRect;
      const startRight = startRect.x + startRect.width;
      const startBottom = startRect.y + startRect.height;
      const originalUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const maxWidth = Math.max(
          COPILOT_WINDOW_WIDTH_MIN,
          Math.min(COPILOT_WINDOW_WIDTH_MAX, viewportWidth - COPILOT_FLOATING_MARGIN * 2),
        );
        const maxHeight = Math.max(
          COPILOT_WINDOW_HEIGHT_MIN,
          Math.min(COPILOT_WINDOW_HEIGHT_MAX, viewportHeight - COPILOT_FLOATING_MARGIN * 2),
        );
        let left = startRect.x;
        let right = startRight;
        let top = startRect.y;
        let bottom = startBottom;

        if (direction.includes("e")) {
          right = clampNumber(
            startRight + (moveEvent.clientX - startX),
            left + COPILOT_WINDOW_WIDTH_MIN,
            Math.min(viewportWidth - COPILOT_FLOATING_MARGIN, left + maxWidth),
          );
        }
        if (direction.includes("w")) {
          left = clampNumber(
            startRect.x + (moveEvent.clientX - startX),
            Math.max(COPILOT_FLOATING_MARGIN, right - maxWidth),
            right - COPILOT_WINDOW_WIDTH_MIN,
          );
        }
        if (direction.includes("s")) {
          bottom = clampNumber(
            startBottom + (moveEvent.clientY - startY),
            top + COPILOT_WINDOW_HEIGHT_MIN,
            Math.min(viewportHeight - COPILOT_FLOATING_MARGIN, top + maxHeight),
          );
        }
        if (direction.includes("n")) {
          top = clampNumber(
            startRect.y + (moveEvent.clientY - startY),
            Math.max(COPILOT_FLOATING_MARGIN, bottom - maxHeight),
            bottom - COPILOT_WINDOW_HEIGHT_MIN,
          );
        }

        setCopilotWindowRect({
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        });
      };

      const handlePointerUp = () => {
        document.body.style.userSelect = originalUserSelect;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [copilotWindowRect],
  );

  const onAskCopilot = useCallback(async (questionOverride?: string) => {
    const question = (questionOverride ?? copilotQuestion).trim();
    const activeQueryContext = (activeQuery || "").trim();
    const query = activeQueryContext && activeQueryContext.toLowerCase() !== "saved searches"
      ? activeQueryContext
      : q.trim();
    const listingMap = new Map(filteredResults.map((item) => [getListingKey(item), item]));
    const selectedListings = copilotSelectedListingKeys
      .map((listingKey) => listingMap.get(listingKey) ?? null)
      .filter((item): item is Listing => item !== null);
    const sourceListings =
      (selectedListings.length > 0 ? selectedListings : filteredResults).slice(0, 25);
    const listingContext = sourceListings.map(buildCopilotListingContext);

    if (!question) {
      setCopilotError("Ask about an item, or load listings to include the current search results.");
      return;
    }

    const userMessage: CopilotMessage = {
      id: createCopilotMessageId(),
      role: "user",
      content: question,
    };
    const conversationPayload: CopilotConversationPayload[] = copilotMessages
      .slice(-12)
      .map((message) => ({
        role: message.role,
        content: message.answer?.trim() || message.content,
      }));
    const sessionVersion = copilotSessionVersionRef.current;

    setCopilotOpen(true);
    setCopilotMessages((prev) => [...prev, userMessage]);
    setCopilotQuestion("");
    setCopilotLoading(true);
    setCopilotError(null);
    try {
      const res = await fetch(`${API_BASE}/copilot/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(query ? { query } : {}),
          user_question: question,
          listings: listingContext,
          conversation: conversationPayload,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`POST /copilot/query failed (${res.status}): ${text}`);
      }
      const json = (await res.json()) as CopilotResponse;
      if (copilotSessionVersionRef.current !== sessionVersion) return;
      setLatestShortlist(json.shortlist);
      setCopilotMessages((prev) => [
        ...prev,
        {
          id: createCopilotMessageId(),
          role: "assistant",
          content: buildAssistantConversationContent(json),
          answer: json.answer,
          seller_questions: json.seller_questions,
          red_flags: json.red_flags,
          available: json.available,
          error_message: json.error_message ?? null,
        },
      ]);
      if (!json.available && json.error_message) {
        setCopilotError(json.error_message);
      }
    } catch (err: unknown) {
      if (copilotSessionVersionRef.current !== sessionVersion) return;
      setCopilotError(err instanceof Error ? err.message : "Failed to query copilot");
    } finally {
      if (copilotSessionVersionRef.current === sessionVersion) {
        setCopilotLoading(false);
      }
    }
  }, [API_BASE, activeQuery, copilotMessages, copilotQuestion, copilotSelectedListingKeys, filteredResults, q]);

  const hasSourceErrorEntries = Object.keys(sourceErrors).length > 0;
  const summarySources = sources;
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
      locationProvince={locationProvince}
      setLocationProvince={setLocationProvince}
      locationCityInput={locationCityInput}
      setLocationCityInput={setLocationCityInput}
      currentLocation={currentLocation}
      locationPersistence={locationPersistence}
      locationSuggestions={locationSuggestions}
      onApplyManualLocation={onApplyManualLocation}
      onUseMyLocation={onUseMyLocation}
      onClearLocation={onClearLocation}
      locationBusy={locationBusy}
      locationError={locationError}
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
      openCopilot={openCopilot}
      closeCopilot={closeCopilot}
      copilotQuestion={copilotQuestion}
      setCopilotQuestion={setCopilotQuestion}
      copilotLoading={copilotLoading}
      copilotError={copilotError}
      copilotMessages={copilotMessages}
      latestShortlist={latestShortlist}
      copilotSelectionMode={copilotSelectionMode}
      toggleCopilotSelectionMode={toggleCopilotSelectionMode}
      copilotSelectedListingKeys={copilotSelectedListingKeys}
      clearCopilotSelection={clearCopilotSelection}
      removeListingFromCopilotSelection={removeListingFromCopilotSelection}
      onToggleListingSelection={onToggleListingSelection}
      resetCopilotConversation={resetCopilotConversation}
      copilotWindowRect={copilotWindowRect}
      copilotLauncherPosition={copilotLauncherPosition}
      onCopilotLauncherDragStart={onCopilotLauncherDragStart}
      onCopilotWindowDragStart={onCopilotWindowDragStart}
      onCopilotResizeStart={onCopilotResizeStart}
      onAskCopilot={onAskCopilot}
    />
  );
}
