(() => {
  const LOG_PREFIX = "[Marketly]";
  const INGEST_PATH = "/connectors/facebook/ingest";
  const DEBOUNCE_MS = 1200;
  const ITEM_HREF_SELECTOR = 'a[href*="/marketplace/item/"]';

  const extractMarketplaceCards = () => {
    const normalizeText = (value) => (value || "").replace(/\s+/g, " ").trim();
    const toLines = (value) =>
      (value || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const itemHrefSelector = 'a[href*="/marketplace/item/"]';
    const countItemAnchors = (node) => {
      if (!node || typeof node.querySelectorAll !== "function") return 0;
      return node.querySelectorAll(itemHrefSelector).length;
    };

    const anchors = Array.from(document.querySelectorAll(itemHrefSelector));
    const seen = new Set();
    const items = [];

    for (const anchor of anchors) {
      const rawHref = anchor.getAttribute("href") || "";
      if (!rawHref || seen.has(rawHref)) continue;
      seen.add(rawHref);

      let container = anchor;
      for (let i = 0; i < 12; i++) {
        const parent = container.parentElement;
        if (!parent) break;
        if (countItemAnchors(parent) > 1) break;
        container = parent;
      }

      const ariaLabel = normalizeText(anchor.getAttribute("aria-label") || "");
      const rawText = container.innerText || anchor.innerText || ariaLabel || "";
      const lines = toLines(rawText);
      const text = normalizeText(rawText);
      const images = Array.from(container.querySelectorAll("img"))
        .map((img) => img.src || "")
        .filter(Boolean);
      const scopes = [];
      const seenScopeTexts = new Set();
      let scopeNode = anchor;
      for (let depth = 0; depth < 10 && scopeNode; depth += 1, scopeNode = scopeNode.parentElement) {
        const scopeRawText = scopeNode.innerText || "";
        const scopeText = normalizeText(scopeRawText);
        const scopeLines = toLines(scopeRawText).slice(0, 12);
        if (!scopeText || !scopeLines.length) continue;
        if (scopeText.length > 420 || scopeLines.length > 12) continue;
        if (seenScopeTexts.has(scopeText)) continue;
        seenScopeTexts.add(scopeText);
        scopes.push({
          depth,
          text: scopeText,
          lines: scopeLines,
        });
      }
      if (ariaLabel && !seenScopeTexts.has(ariaLabel)) {
        scopes.push({
          depth: 0,
          text: ariaLabel,
          lines: toLines(ariaLabel),
        });
      }

      items.push({
        href: rawHref,
        title: normalizeText(anchor.innerText || ariaLabel || ""),
        text,
        lines,
        image_urls: images.slice(0, 4),
        scopes,
      });
    }

    return items;
  };

  const readQueryFromUrl = () => {
    try {
      const params = new URLSearchParams(window.location.search);
      return (params.get("query") || "").trim();
    } catch (err) {
      console.warn(LOG_PREFIX, "failed to read query from URL", err);
      return "";
    }
  };

  const readSettings = () =>
    new Promise((resolve) => {
      chrome.storage.local.get(["apiBase", "helperToken"], (result) => {
        const apiBase = (result && result.apiBase ? String(result.apiBase) : "").trim().replace(/\/+$/, "");
        const helperToken = (result && result.helperToken ? String(result.helperToken) : "").trim();
        resolve({ apiBase, helperToken });
      });
    });

  const sendIngest = async ({ query, items }) => {
    const { apiBase, helperToken } = await readSettings();
    if (!apiBase || !helperToken) {
      console.warn(LOG_PREFIX, "helper not paired; open the extension options to pair it.");
      return;
    }
    try {
      const response = await fetch(`${apiBase}${INGEST_PATH}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${helperToken}`,
        },
        body: JSON.stringify({ query, items }),
      });
      if (!response.ok) {
        console.warn(LOG_PREFIX, `ingest failed status=${response.status}`);
        return;
      }
      const payload = await response.json().catch(() => ({}));
      console.log(LOG_PREFIX, "ingest ok", payload);
    } catch (err) {
      console.warn(LOG_PREFIX, "ingest request failed", err);
    }
  };

  let debounceTimer = null;
  let lastSignature = "";

  const scheduleScrape = () => {
    if (!document.querySelector(ITEM_HREF_SELECTOR)) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      const query = readQueryFromUrl();
      if (!query) return;
      let items;
      try {
        items = extractMarketplaceCards();
      } catch (err) {
        console.warn(LOG_PREFIX, "extraction failed", err);
        return;
      }
      if (!items.length) return;
      const signature = `${query}|${items.length}|${items[0].href || ""}|${items[items.length - 1].href || ""}`;
      if (signature === lastSignature) return;
      lastSignature = signature;
      console.log(LOG_PREFIX, `sending ${items.length} cards for query=${query}`);
      await sendIngest({ query, items });
    }, DEBOUNCE_MS);
  };

  const observer = new MutationObserver(() => scheduleScrape());
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleScrape();
})();
