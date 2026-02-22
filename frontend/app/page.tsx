"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "./providers";

const SOURCE_OPTIONS = ["kijiji", "ebay", "facebook"] as const;
const DEFAULT_SOURCES: SourceOption[] = ["kijiji", "ebay", "facebook"];
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

export default function HomePage() {
  const { user, loading: authLoading, signOut, accessToken } = useAuth();
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

  const [q, setQ] = useState("");
  const [sources, setSources] = useState<SourceOption[]>(DEFAULT_SOURCES);
  const [sortBy, setSortBy] = useState<SortOption>("relevance");
  const [limit, setLimit] = useState(20);

  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Listing[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [sourceErrors, setSourceErrors] = useState<Record<string, SourceErrorEntry>>({});
  const [hasSearched, setHasSearched] = useState(false);

  const [activeQuery, setActiveQuery] = useState("");
  const [activeSources, setActiveSources] = useState<SourceOption[]>(DEFAULT_SOURCES);
  const [activeSort, setActiveSort] = useState<SortOption>("relevance");
  const [activeLimit, setActiveLimit] = useState(20);

  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [activeSavedSearchId, setActiveSavedSearchId] = useState<number | null>(null);

  const [editing, setEditing] = useState<SavedSearch | null>(null);
  const [editQuery, setEditQuery] = useState("");
  const [editSources, setEditSources] = useState<SourceOption[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const seenKeysRef = useRef<Set<string>>(new Set());
  const fetchInFlightRef = useRef(false);

  const requestUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("q", q.trim());
    for (const source of sources) {
      params.append("sources", source);
    }
    params.set("sort", sortBy);
    params.set("limit", String(limit));
    params.set("offset", "0");
    return `${API_BASE}/search?${params.toString()}`;
  }, [API_BASE, limit, q, sortBy, sources]);

  const hasMore = hasSearched && nextOffset !== null;

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

  const loadMore = useCallback(async () => {
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
    loadingMore,
    nextOffset,
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

  async function fetchSavedSearches() {
    setSavedLoading(true);
    setSavedError(null);

    try {
      if (!accessToken) {
        setSaved([]);
        return;
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
    } catch (err: unknown) {
      setSavedError(err instanceof Error ? err.message : "Failed to load saved searches");
    } finally {
      setSavedLoading(false);
    }
  }

  useEffect(() => {
    if (user) {
      void fetchSavedSearches();
    } else {
      setSaved([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, accessToken]);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query || sources.length === 0) return;

    setActiveSavedSearchId(null);
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

  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">Marketly</h1>
          <p className="text-sm text-gray-400">
            Unified marketplace search (Kijiji + eBay + Facebook). 
          </p>
        </header>

        <div className="flex items-center gap-3">
          {authLoading ? (
            <span className="text-sm text-gray-400">Loading auth...</span>
          ) : user ? (
            <>
              <span className="text-sm">Logged in as: {user.email}</span>
              <button
                onClick={signOut}
                className="rounded-md border border-gray-700 px-3 py-1 text-sm"
                type="button"
              >
                Logout
              </button>
            </>
          ) : (
            <Link className="text-sm underline" href="/login">
              Login
            </Link>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="space-y-4 lg:col-span-2">
            <form onSubmit={onSearch} className="space-y-4 rounded-xl border border-gray-800 p-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Search</label>
                <input
                  className="w-full rounded-lg border border-gray-700 bg-transparent px-3 py-2"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="e.g., iphone, macbook, snowboard"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className="rounded-lg bg-white px-4 py-2 text-black disabled:opacity-60"
                  disabled={searchLoading || loadingMore || !q.trim() || sources.length === 0}
                >
                  {searchLoading ? "Searching..." : "Search"}
                </button>

                <button
                  type="button"
                  className="rounded-lg border border-gray-700 px-4 py-2 disabled:opacity-60"
                  onClick={onSaveCurrentSearch}
                  disabled={!q.trim() || sources.length === 0}
                >
                  Save search
                </button>

                <a
                  className="text-sm text-gray-300 underline"
                  href={`${API_BASE}/docs`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open API docs
                </a>
              </div>

              <div className="break-all text-xs text-gray-500">Request: {requestUrl}</div>
            </form>

            <div className="sticky top-3 z-10 rounded-xl border border-gray-800 bg-black/85 p-3 backdrop-blur">
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Sources</p>
                  <div className="flex flex-wrap gap-2">
                    {SOURCE_OPTIONS.map((source) => {
                      const selected = sources.includes(source);
                      return (
                        <button
                          key={source}
                          type="button"
                          onClick={() => toggleSource(source)}
                          className={`rounded-full border px-3 py-1 text-sm capitalize transition ${
                            selected
                              ? "border-white bg-white text-black"
                              : "border-gray-700 text-gray-300 hover:border-gray-500"
                          }`}
                        >
                          {source}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-400">
                    Sort
                  </label>
                  <select
                    className="rounded-lg border border-gray-700 bg-black px-3 py-2 text-sm"
                    value={sortBy}
                    onChange={(e) => void onChangeSort(e.target.value as SortOption)}
                  >
                    {SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value} disabled={option.disabled}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-400">
                    Limit
                  </label>
                  <input
                    className="w-24 rounded-lg border border-gray-700 bg-black px-3 py-2 text-sm"
                    type="number"
                    value={limit}
                    min={1}
                    max={50}
                    onChange={(e) => setLimit(Number(e.target.value))}
                  />
                </div>
              </div>

              {sources.length === 0 ? (
                <p className="mt-2 text-xs text-red-300">Select at least one source to search.</p>
              ) : null}
            </div>

            {error && (
              <div className="rounded-xl border border-red-700 bg-red-900/30 p-4 text-red-200">{error}</div>
            )}
            {Object.keys(sourceErrors).length > 0 && (
              <div className="rounded-xl border border-amber-700 bg-amber-900/20 p-4 text-amber-100">
                <p className="text-sm font-medium">One or more sources are unavailable.</p>
                {sourceErrors.facebook ? (
                  <p className="mt-1 text-xs text-amber-200">
                    Facebook source unavailable: {sourceErrors.facebook.message}
                  </p>
                ) : null}
                <ul className="mt-2 space-y-1 text-xs text-amber-200">
                  {Object.entries(sourceErrors).map(([source, sourceError]) => (
                    <li key={source}>
                      {source}: {sourceError.code} - {sourceError.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {searchLoading && results.length === 0 && (
              <section className="space-y-3">
                <h2 className="text-xl font-semibold">Results</h2>
                <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <li
                      key={`skeleton-${index}`}
                      className="h-36 animate-pulse rounded-xl border border-gray-800 bg-gray-900/70"
                    />
                  ))}
                </ul>
              </section>
            )}

            {hasSearched && !searchLoading && (
              <section className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-xl font-semibold">
                    Results ({total ?? results.length})
                  </h2>
                  <p className="text-xs text-gray-500">
                    Showing {results.length}
                    {total !== null ? ` of ${total}` : ""}
                  </p>
                </div>

                {results.length === 0 ? (
                  <div className="rounded-xl border border-gray-800 p-4 text-sm text-gray-400">
                    No results found.
                  </div>
                ) : (
                  <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {results.map((item) => {
                      const img = item.image_urls?.[0];
                      const cardKey = `${item.source}:${item.source_listing_id || item.url}`;
                      return (
                        <li key={cardKey} className="rounded-xl border border-gray-800 p-4">
                          <div className="flex gap-4">
                            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-900">
                              {img ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={img} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <span className="text-xs text-gray-500">No image</span>
                              )}
                            </div>

                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="line-clamp-2 font-medium hover:underline"
                                >
                                  {item.title}
                                </a>
                                <span className="rounded-full border border-gray-700 px-2 py-0.5 text-[11px] uppercase tracking-wide text-gray-300">
                                  {formatSourceLabel(item.source)}
                                </span>
                              </div>

                              <div className="text-sm text-gray-300">
                                <span className="font-semibold">{formatPrice(item.price)}</span>
                                {item.location ? <span className="text-gray-500"> | {item.location}</span> : null}
                              </div>

                              <div className="text-xs text-gray-500">
                                {typeof item.score === "number" ? `Score ${item.score.toFixed(2)}` : ""}
                              </div>

                              {item.snippet ? (
                                <p className="line-clamp-2 text-sm text-gray-400">{item.snippet}</p>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div ref={sentinelRef} className="h-2" />

                {loadingMore ? (
                  <div className="rounded-lg border border-gray-800 p-3 text-center text-sm text-gray-400">
                    Loading more...
                  </div>
                ) : null}

                {!hasMore && results.length > 0 ? (
                  <div className="text-center text-xs text-gray-500">No more results.</div>
                ) : null}
              </section>
            )}
          </section>

          <aside className="space-y-3">
            <div className="space-y-3 rounded-xl border border-gray-800 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Saved searches</h2>
                <button
                  className="text-sm text-gray-300 underline"
                  onClick={() => void fetchSavedSearches()}
                  disabled={savedLoading}
                  type="button"
                >
                  {savedLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              {savedError && (
                <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-200">
                  {savedError}
                </div>
              )}

              {saved.length === 0 ? (
                <p className="text-sm text-gray-500">
                  {user ? "No saved searches yet." : "Log in to see your saved searches."}
                </p>
              ) : (
                <ul className="space-y-2">
                  {saved.map((entry) => (
                    <li key={entry.id} className="space-y-2 rounded-lg border border-gray-800 p-3">
                      <div className="line-clamp-1 text-sm font-medium">{entry.query}</div>
                      <div className="text-xs text-gray-500">
                        {entry.sources.join(", ")} | id {entry.id}
                      </div>

                      <div className="flex gap-2">
                        <button
                          className="rounded-md bg-white px-3 py-1 text-sm text-black"
                          type="button"
                          onClick={() => void onRunSavedSearch(entry.id)}
                        >
                          Run
                        </button>
                        <button
                          className="rounded-md border border-gray-700 px-3 py-1 text-sm"
                          type="button"
                          onClick={() => openEdit(entry)}
                        >
                          Edit
                        </button>
                        <button
                          className="rounded-md border border-gray-700 px-3 py-1 text-sm"
                          type="button"
                          onClick={() => void onDeleteSavedSearch(entry.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </div>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg space-y-4 rounded-xl border border-gray-800 bg-black p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Edit saved search</h3>
                <p className="text-xs text-gray-500">Update the query and sources.</p>
              </div>
              <button
                type="button"
                className="text-xs text-gray-400"
                onClick={closeEdit}
                disabled={editSaving}
              >
                Close
              </button>
            </div>

            {editError && (
              <div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-200">
                {editError}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Query</label>
              <input
                className="w-full rounded-lg border border-gray-700 bg-transparent px-3 py-2"
                value={editQuery}
                onChange={(e) => setEditQuery(e.target.value)}
                placeholder="e.g., iphone, macbook, snowboard"
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Sources</p>
              <div className="flex flex-wrap gap-2">
                {SOURCE_OPTIONS.map((source) => {
                  const selected = editSources.includes(source);
                  return (
                    <button
                      key={`edit-source-${source}`}
                      type="button"
                      onClick={() => toggleEditSource(source)}
                      className={`rounded-full border px-3 py-1 text-sm capitalize transition ${
                        selected
                          ? "border-white bg-white text-black"
                          : "border-gray-700 text-gray-300 hover:border-gray-500"
                      }`}
                    >
                      {source}
                    </button>
                  );
                })}
              </div>
              {editSources.length === 0 ? (
                <p className="text-xs text-red-300">Select at least one source.</p>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                className="rounded-md border border-gray-700 px-3 py-1 text-sm"
                type="button"
                onClick={closeEdit}
                disabled={editSaving}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-white px-3 py-1 text-sm text-black disabled:opacity-60"
                type="button"
                onClick={() => void onSaveEdit()}
                disabled={editSaving || !editQuery.trim() || editSources.length === 0}
              >
                {editSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
