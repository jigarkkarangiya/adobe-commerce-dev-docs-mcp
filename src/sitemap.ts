import { XMLParser } from "fast-xml-parser";
import { readFile, writeFile, mkdir, stat, unlink } from "node:fs/promises";
import { config } from "./config.js";

// --- Types ---

export interface DocEntry {
  url: string;
  lastmod: string;
  path: string;
  pathSegments: string[];
  title: string;
  section: string;
}

export interface SearchResult {
  entry: DocEntry;
  score: number;
  snippet: string;
}

// --- Developer-audience synonym map for query expansion ---
//
// Tuned for the kind of queries devs run against the PHP / API / extensibility
// docs. Entries are bidirectional: every key→values pair has a matching
// values→key entry so the order of the user's terms doesn't matter.

const SYNONYM_MAP: Record<string, string[]> = {
  graphql: ["gql"],
  gql: ["graphql"],
  rest: ["webapi"],
  webapi: ["rest"],
  api: ["webapi"],
  webhook: ["webhooks", "events"],
  webhooks: ["webhook", "events"],
  event: ["events", "webhook", "observer"],
  events: ["event", "webhook", "observer"],
  observer: ["event", "events"],
  appbuilder: ["app-builder", "extensibility"],
  "app-builder": ["appbuilder", "extensibility"],
  extensibility: ["appbuilder", "app-builder"],
  mftf: ["functional", "test", "testing"],
  testing: ["test", "mftf"],
  test: ["testing", "mftf"],
  pwa: ["headless", "storefront"],
  headless: ["pwa"],
  storefront: ["frontend", "pwa", "luma"],
  frontend: ["storefront", "theme"],
  theme: ["frontend"],
  luma: ["theme", "storefront"],
  composer: ["package", "dependency"],
  module: ["extension", "component"],
  extension: ["module", "component"],
  component: ["module"],
  plugin: ["interceptor"],
  interceptor: ["plugin"],
  di: ["dependency", "injection"],
  dependency: ["di", "injection"],
  injection: ["di"],
  cron: ["scheduled", "job"],
  cli: ["command", "console"],
  command: ["cli"],
  acl: ["permission", "role", "auth"],
  permission: ["acl", "role"],
  role: ["acl", "permission"],
  indexer: ["reindex", "index"],
  reindex: ["indexer"],
  cache: ["caching"],
  cloud: ["ece", "cloud-tools"],
  ece: ["cloud"],
  eav: ["entity", "attribute"],
  entity: ["eav", "model"],
  attribute: ["eav"],
  layout: ["xml", "ui", "template"],
  ui: ["uicomponent", "layout"],
  uicomponent: ["ui", "component"],
  knockout: ["js", "frontend"],
  requirejs: ["js"],
  js: ["javascript", "knockout", "requirejs"],
  javascript: ["js"],
  schema: ["graphql", "type"],
  query: ["graphql"],
  mutation: ["graphql"],
  resolver: ["graphql"],
  marketplace: ["publish", "extension"],
  publish: ["marketplace"],
  admin: ["adminhtml", "backend", "admin-developer"],
  adminhtml: ["admin"],
  saas: ["services"],
  service: ["services"],
  magento: ["commerce"],
  commerce: ["magento"],
  upgrade: ["update", "migration"],
  patch: ["hotfix"],
  declarative: ["db_schema", "schema"],
  observability: ["log", "monitor"],
};

// --- Index state ---

let invertedIndex: Map<string, Set<number>> = new Map();
let indexedEntries: DocEntry[] = [];
let docLengths: number[] = [];
let avgDocLength = 1;

// --- URL helpers ---

function isCommerceDevUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.host !== "developer.adobe.com") return false;
    return config.commercePathPrefixes.some((p) =>
      u.pathname.startsWith(p),
    );
  } catch {
    return false;
  }
}

/**
 * Extract the section slug — the URL segment immediately following
 * `/commerce/`. For `/commerce/php/development/components` returns `php`.
 */
export function extractSection(pathOrUrl: string): string | null {
  let pathname = pathOrUrl;
  try {
    if (pathname.startsWith("http")) {
      pathname = new URL(pathname).pathname;
    }
  } catch {
    // already a path
  }

  const parts = pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[0] === "commerce") {
    return parts[1];
  }
  return null;
}

function urlToTitle(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    // Skip "commerce" + section → keep the meaningful tail
    return segments
      .slice(2)
      .map((s) =>
        s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      )
      .join(" > ");
  } catch {
    return url;
  }
}

// --- XML / Sitemap fetching ---

async function fetchUrl(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": config.userAgent },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

function createXmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) =>
      name === "url" || name === "xhtml:link" || name === "sitemap",
  });
}

function extractEntriesFromUrlset(parsed: any): DocEntry[] {
  const entries: DocEntry[] = [];
  let urls: any[] = [];

  if (parsed.urlset?.url) {
    urls = Array.isArray(parsed.urlset.url)
      ? parsed.urlset.url
      : [parsed.urlset.url];
  }

  for (const urlEntry of urls) {
    const loc = urlEntry.loc;
    if (!loc || !isCommerceDevUrl(loc)) continue;

    const lastmod = urlEntry.lastmod || "";

    let path: string;
    try {
      path = new URL(loc).pathname;
    } catch {
      path = loc;
    }

    const pathSegments = path
      .split("/")
      .filter(Boolean)
      .map((s) => s.replace(/-/g, " ").toLowerCase());

    const section = extractSection(path) || "";

    entries.push({
      url: loc,
      lastmod,
      path,
      pathSegments,
      title: urlToTitle(loc),
      section,
    });
  }

  // Deduplicate URLs that may appear with both trailing and non-trailing slash
  const seen = new Set<string>();
  const deduped: DocEntry[] = [];
  for (const e of entries) {
    const key = e.url.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }
  return deduped;
}

async function fetchWithConcurrency(
  urls: string[],
  limit: number,
): Promise<PromiseSettledResult<string>[]> {
  const results: PromiseSettledResult<string>[] = new Array(urls.length);
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      const idx = cursor++;
      try {
        const text = await fetchUrl(urls[idx]);
        results[idx] = { status: "fulfilled", value: text };
      } catch (err) {
        results[idx] = {
          status: "rejected",
          reason: err instanceof Error ? err : new Error(String(err)),
        };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, urls.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

async function fetchSitemap(): Promise<DocEntry[]> {
  const xml = await fetchUrl(config.sitemapUrl);
  const parser = createXmlParser();
  const parsed = parser.parse(xml);

  if (parsed.sitemapindex?.sitemap) {
    const sitemaps = Array.isArray(parsed.sitemapindex.sitemap)
      ? parsed.sitemapindex.sitemap
      : [parsed.sitemapindex.sitemap];

    const childUrls = sitemaps
      .map((s: any) => s.loc)
      .filter((loc: any): loc is string => typeof loc === "string");

    if (childUrls.length === 0) return [];

    console.error(
      `Sitemap index: ${childUrls.length} child sitemaps, fetching...`,
    );

    const results = await fetchWithConcurrency(
      childUrls,
      config.maxConcurrentFetches,
    );
    const allEntries: DocEntry[] = [];
    const childParser = createXmlParser();

    for (const result of results) {
      if (result.status === "fulfilled") {
        try {
          allEntries.push(
            ...extractEntriesFromUrlset(childParser.parse(result.value)),
          );
        } catch {
          // skip malformed
        }
      }
    }

    return allEntries;
  }

  return extractEntriesFromUrlset(parsed);
}

// --- Tokenization & index building ---

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s/\-_>]+/)
    .filter((t) => t.length > 1);
}

function buildInvertedIndex(entries: DocEntry[]): Map<string, Set<number>> {
  const index = new Map<string, Set<number>>();
  const lengths: number[] = new Array(entries.length);
  let totalLength = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const tokens = new Set([
      ...tokenize(entry.path),
      ...entry.pathSegments,
      ...tokenize(entry.title),
    ]);

    lengths[i] = tokens.size;
    totalLength += tokens.size;

    for (const token of tokens) {
      let set = index.get(token);
      if (!set) {
        set = new Set();
        index.set(token, set);
      }
      set.add(i);
    }
  }

  docLengths = lengths;
  avgDocLength = entries.length > 0 ? totalLength / entries.length : 1;
  return index;
}

// --- Fuzzy matching (Levenshtein) ---

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

function findFuzzyMatches(term: string, maxDist: number = 2): Set<number> {
  const matches = new Set<number>();
  if (term.length < 4) return matches;

  for (const [key, indices] of invertedIndex) {
    if (Math.abs(key.length - term.length) > maxDist) continue;
    if (levenshtein(term, key) <= maxDist) {
      for (const idx of indices) matches.add(idx);
    }
  }
  return matches;
}

// --- Synonym expansion ---

export function expandWithSynonyms(terms: string[]): string[] {
  const expanded = new Set(terms);
  for (const term of terms) {
    const syns = SYNONYM_MAP[term];
    if (syns) {
      for (const s of syns) {
        for (const t of s.split(/\s+/)) {
          if (t.length > 1) expanded.add(t);
        }
      }
    }
  }
  return Array.from(expanded);
}

// --- BM25 helpers ---

function getDocFrequency(term: string): number {
  let df = 0;
  for (const [key, indices] of invertedIndex) {
    if (key.includes(term)) df += indices.size;
  }
  return Math.min(df, indexedEntries.length);
}

function computeIDF(term: string, N: number): number {
  const df = getDocFrequency(term);
  if (df === 0) return 0;
  return Math.log((N - df + 0.5) / (df + 0.5) + 1);
}

function buildSnippet(entry: DocEntry, terms: string[]): string {
  // Skip the leading "commerce/<section>" segments — they are always present
  // and don't add anything informative to the snippet.
  const segments = entry.path
    .split("/")
    .filter(Boolean)
    .slice(2);
  const matched: string[] = [];

  for (const seg of segments) {
    const low = seg.toLowerCase();
    if (terms.some((t) => low.includes(t))) {
      matched.push(seg.replace(/-/g, " "));
    }
  }

  return matched.length > 0
    ? `Matched in: ${matched.join(" > ")}`
    : `Path: ${segments.slice(-2).join(" > ").replace(/-/g, " ")}`;
}

// --- Cache ---

async function loadFromCache(): Promise<DocEntry[] | null> {
  try {
    const info = await stat(config.sitemapCacheFile);
    if (Date.now() - info.mtimeMs > config.sitemapCacheTtlMs) return null;
    const data = await readFile(config.sitemapCacheFile, "utf-8");
    const entries = JSON.parse(data) as DocEntry[];
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}

async function saveToCache(entries: DocEntry[]): Promise<void> {
  try {
    await mkdir(config.cacheDir, { recursive: true });
    await writeFile(config.sitemapCacheFile, JSON.stringify(entries), "utf-8");
  } catch {
    // non-critical
  }
}

export async function clearCache(): Promise<void> {
  try {
    await unlink(config.sitemapCacheFile);
  } catch {
    // file may not exist
  }
}

// --- Public API ---

export async function loadSitemap(): Promise<DocEntry[]> {
  const cached = await loadFromCache();
  if (cached) {
    indexedEntries = cached;
    invertedIndex = buildInvertedIndex(cached);
    return cached;
  }

  const entries = await fetchSitemap();
  await saveToCache(entries);
  indexedEntries = entries;
  invertedIndex = buildInvertedIndex(entries);
  return entries;
}

/**
 * BM25-scored search with synonym expansion and fuzzy fallback.
 */
export function searchEntries(
  entries: DocEntry[],
  query: string,
  limit: number = 20,
): SearchResult[] {
  const rawTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (rawTerms.length === 0) {
    return entries
      .slice(0, limit)
      .map((entry) => ({ entry, score: 0, snippet: "" }));
  }

  const allTerms = expandWithSynonyms(rawTerms);
  const useIndex = entries === indexedEntries && invertedIndex.size > 0;
  const N = entries.length;
  const k1 = 1.5;
  const b = 0.75;

  let candidateIndices: Set<number> | null = null;
  if (useIndex) {
    candidateIndices = new Set<number>();
    for (const term of allTerms) {
      for (const [key, indices] of invertedIndex) {
        if (key.includes(term)) {
          for (const idx of indices) candidateIndices.add(idx);
        }
      }
    }
    for (const term of rawTerms) {
      let hasExact = false;
      for (const [key] of invertedIndex) {
        if (key.includes(term)) {
          hasExact = true;
          break;
        }
      }
      if (!hasExact) {
        for (const idx of findFuzzyMatches(term)) candidateIndices.add(idx);
      }
    }
  }

  const pool =
    useIndex && candidateIndices
      ? Array.from(candidateIndices).map((i) => ({ entry: entries[i], idx: i }))
      : entries.map((entry, idx) => ({ entry, idx }));

  const scored: SearchResult[] = [];

  for (const { entry, idx } of pool) {
    const pathLower = entry.path.toLowerCase();
    const titleLower = entry.title.toLowerCase();
    const lastSeg = entry.pathSegments[entry.pathSegments.length - 1] || "";
    const dl = useIndex ? (docLengths[idx] || 1) : entry.pathSegments.length;

    let score = 0;
    let matchedOriginal = 0;

    for (const term of allTerms) {
      const inPath = pathLower.includes(term);
      const inTitle = titleLower.includes(term);
      const inSegs = entry.pathSegments.some((s) => s.includes(term));

      if (!inPath && !inTitle && !inSegs) continue;

      const idf = useIndex ? computeIDF(term, N) : 1;
      let tf = 0;
      if (inPath) tf++;
      if (inTitle) tf++;
      if (inSegs) tf++;

      const tfNorm =
        (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * dl) / avgDocLength));
      score += idf * tfNorm;

      if (lastSeg.includes(term)) score += idf * 0.5;
      if (rawTerms.includes(term)) matchedOriginal++;
    }

    if (matchedOriginal >= rawTerms.length && rawTerms.length > 1) {
      score *= 2;
    }

    if (score > 0) {
      scored.push({ entry, score, snippet: buildSnippet(entry, rawTerms) });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function getDocSections(entries: DocEntry[]): Map<string, number> {
  const sections = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.section) continue;
    sections.set(entry.section, (sections.get(entry.section) || 0) + 1);
  }
  return sections;
}

export function getSectionSlugs(entries: DocEntry[]): string[] {
  return [...getDocSections(entries).keys()].sort();
}

export function getSectionEntries(
  entries: DocEntry[],
  section: string,
): DocEntry[] {
  return entries.filter((e) => e.section === section);
}

export function getRelatedDocs(
  entries: DocEntry[],
  url: string,
  limit: number = 10,
): DocEntry[] {
  const target = entries.find((e) => e.url === url);
  if (!target) return [];

  const targetParts = target.path.split("/").filter(Boolean);
  if (targetParts.length < 3) return [];

  const parentPath = targetParts.slice(0, -1).join("/");

  return entries
    .filter((e) => {
      if (e.url === url) return false;
      const parts = e.path.split("/").filter(Boolean);
      return parts.slice(0, -1).join("/") === parentPath;
    })
    .slice(0, limit);
}

export function findEntryByUrl(
  entries: DocEntry[],
  url: string,
): DocEntry | undefined {
  return entries.find((e) => e.url === url);
}
