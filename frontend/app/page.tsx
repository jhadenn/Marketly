"use client";

import { useEffect, useMemo, useState } from "react";

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
};

type SavedSearch = {
  id: number;
  query: string;
  sources: string[];
  created_at: string;
};

function formatPrice(price?: Money | null) {
  if (!price) return "—";
  return `${price.currency} ${price.amount}`;
}

export default function HomePage() {
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

  // search form state
  const [q, setQ] = useState("iphone");
  const [sources, setSources] = useState("kijiji");
  const [limit, setLimit] = useState(20);

  // search results state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);

  // saved searches state
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);

  const requestUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("q", q);
    params.set("sources", sources);
    params.set("limit", String(limit));
    return `${API_BASE}/search?${params.toString()}`;
  }, [API_BASE, q, sources, limit]);

  async function fetchSavedSearches() {
    setSavedLoading(true);
    setSavedError(null);
    try {
      const res = await fetch(`${API_BASE}/saved-searches`, { cache: "no-store" });
      if (!res.ok) throw new Error(`GET /saved-searches failed (${res.status})`);
      const json = (await res.json()) as SavedSearch[];
      setSaved(json);
    } catch (err: any) {
      setSavedError(err?.message ?? "Failed to load saved searches");
    } finally {
      setSavedLoading(false);
    }
  }

  useEffect(() => {
    // load saved searches on first render
    fetchSavedSearches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch(requestUrl, { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API error ${res.status}: ${text}`);
      }
      const json = (await res.json()) as SearchResponse;
      setData(json);
    } catch (err: any) {
      setError(err?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function onSaveCurrentSearch() {
    setSavedError(null);
    try {
      const payload = {
        query: q,
        sources: sources
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };

      const res = await fetch(`${API_BASE}/saved-searches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`POST /saved-searches failed (${res.status}): ${text}`);
      }

      await fetchSavedSearches();
    } catch (err: any) {
      setSavedError(err?.message ?? "Failed to save search");
    }
  }

  async function onDeleteSavedSearch(id: number) {
    setSavedError(null);
    try {
      const res = await fetch(`${API_BASE}/saved-searches/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`DELETE /saved-searches/${id} failed (${res.status}): ${text}`);
      }
      await fetchSavedSearches();
    } catch (err: any) {
      setSavedError(err?.message ?? "Failed to delete saved search");
    }
  }

  async function onRunSavedSearch(id: number) {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch(`${API_BASE}/saved-searches/${id}/run?limit=${limit}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Run saved search failed (${res.status}): ${text}`);
      }
      const json = (await res.json()) as SearchResponse;

      // sync the form inputs to what was saved (nice UX)
      setQ(json.query);
      setSources(json.sources.join(","));

      setData(json);
    } catch (err: any) {
      setError(err?.message ?? "Failed to run saved search");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">Marketly MVP</h1>
          <p className="text-sm text-gray-500">
            Unified marketplace search (starting with Kijiji). Backend: {API_BASE}
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT: Search */}
          <section className="lg:col-span-2 space-y-4">
            <form onSubmit={onSearch} className="rounded-xl border p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Search</label>
                  <input
                    className="w-full rounded-lg border px-3 py-2"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="e.g., iphone, macbook, snowboard"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Sources</label>
                  <input
                    className="w-full rounded-lg border px-3 py-2"
                    value={sources}
                    onChange={(e) => setSources(e.target.value)}
                    placeholder="kijiji (later: kijiji,ebay)"
                  />
                  <p className="text-xs text-gray-500">Comma-separated</p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Limit</label>
                  <input
                    className="w-full rounded-lg border px-3 py-2"
                    type="number"
                    value={limit}
                    min={1}
                    max={50}
                    onChange={(e) => setLimit(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className="rounded-lg bg-black text-white px-4 py-2 disabled:opacity-60"
                  disabled={loading || !q.trim()}
                >
                  {loading ? "Searching..." : "Search"}
                </button>

                <button
                  type="button"
                  className="rounded-lg border px-4 py-2 disabled:opacity-60"
                  onClick={onSaveCurrentSearch}
                  disabled={!q.trim()}
                >
                  Save search
                </button>

                <a
                  className="text-sm underline text-gray-700"
                  href={`${API_BASE}/docs`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open API docs
                </a>
              </div>

              <div className="text-xs text-gray-500 break-all">Request: {requestUrl}</div>
            </form>

            {error && (
              <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">
                {error}
              </div>
            )}

            {data && (
              <section className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-xl font-semibold">Results ({data.count})</h2>
                  <p className="text-xs text-gray-500">Sources: {data.sources.join(", ")}</p>
                </div>

                <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {data.results.map((item) => {
                    const img = item.image_urls?.[0];
                    return (
                      <li key={`${item.source}:${item.source_listing_id}`} className="rounded-xl border p-4">
                        <div className="flex gap-4">
                          <div className="w-24 h-24 shrink-0 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center">
                            {img ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={img} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-xs text-gray-400">No image</span>
                            )}
                          </div>

                          <div className="min-w-0 flex-1 space-y-1">
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium hover:underline line-clamp-2"
                            >
                              {item.title}
                            </a>

                            <div className="text-sm text-gray-700">
                              <span className="font-semibold">{formatPrice(item.price)}</span>
                              {item.location ? <span className="text-gray-500"> • {item.location}</span> : null}
                            </div>

                            <div className="text-xs text-gray-500">
                              {item.source}
                              {typeof item.score === "number" ? (
                                <span> • score {item.score.toFixed(2)}</span>
                              ) : null}
                            </div>

                            {item.snippet ? (
                              <p className="text-sm text-gray-600 line-clamp-2">{item.snippet}</p>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </section>

          {/* RIGHT: Saved Searches */}
          <aside className="space-y-3">
            <div className="rounded-xl border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Saved searches</h2>
                <button
                  className="text-sm underline text-gray-700"
                  onClick={fetchSavedSearches}
                  disabled={savedLoading}
                  type="button"
                >
                  {savedLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              {savedError && (
                <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                  {savedError}
                </div>
              )}

              {saved.length === 0 ? (
                <p className="text-sm text-gray-500">No saved searches yet.</p>
              ) : (
                <ul className="space-y-2">
                  {saved.map((s) => (
                    <li key={s.id} className="rounded-lg border p-3 space-y-2">
                      <div className="text-sm font-medium line-clamp-1">{s.query}</div>
                      <div className="text-xs text-gray-500">
                        {s.sources.join(", ")} • id {s.id}
                      </div>

                      <div className="flex gap-2">
                        <button
                          className="rounded-md bg-black text-white px-3 py-1 text-sm"
                          type="button"
                          onClick={() => onRunSavedSearch(s.id)}
                        >
                          Run
                        </button>
                        <button
                          className="rounded-md border px-3 py-1 text-sm"
                          type="button"
                          onClick={() => onDeleteSavedSearch(s.id)}
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
    </main>
  );
}
