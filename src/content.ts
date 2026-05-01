import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { config } from "./config.js";
import { extractSection } from "./sitemap.js";

// --- Types ---

export interface TocEntry {
  level: number;
  title: string;
}

export interface StructuredContent {
  title: string;
  description: string;
  sections: { heading: string; content: string }[];
  codeExamples: { language: string; code: string }[];
  relatedLinks: { text: string; url: string }[];
}

// --- In-memory LRU Cache ---

interface MemCacheEntry {
  content: string;
  timestamp: number;
}

const memoryCache = new Map<string, MemCacheEntry>();

function getFromMemoryCache(url: string): string | null {
  const entry = memoryCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > config.pageCacheMemoryTtlMs) {
    memoryCache.delete(url);
    return null;
  }
  memoryCache.delete(url);
  memoryCache.set(url, entry);
  return entry.content;
}

function setMemoryCache(url: string, content: string): void {
  if (memoryCache.size >= config.pageCacheMemoryMax) {
    const oldest = memoryCache.keys().next().value;
    if (oldest !== undefined) memoryCache.delete(oldest);
  }
  memoryCache.set(url, { content, timestamp: Date.now() });
}

export function clearMemoryCache(): void {
  memoryCache.clear();
}

// --- Persistent Disk Page Cache ---

function urlToHash(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

async function getFromDiskCache(url: string): Promise<string | null> {
  try {
    const filePath = join(config.pageCacheDir, `${urlToHash(url)}.md`);
    const info = await stat(filePath);
    if (Date.now() - info.mtimeMs > config.pageCacheDiskTtlMs) return null;
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function setDiskCache(url: string, content: string): Promise<void> {
  try {
    await mkdir(config.pageCacheDir, { recursive: true });
    await writeFile(
      join(config.pageCacheDir, `${urlToHash(url)}.md`),
      content,
      "utf-8",
    );
  } catch {
    // Non-critical — disk cache write failure shouldn't block
  }
}

// --- GitHub raw markdown URL mapping ---

/**
 * Build the candidate raw.githubusercontent.com URLs that mirror a given
 * developer.adobe.com/commerce page.
 *
 * The dev-site convention is `src/pages/<rest>/index.md` for "directory"
 * URLs and `src/pages/<rest>.md` for leaf URLs. We don't always know which
 * shape a given page uses, so we return both candidates in priority order
 * (leaf first, then index) and let the caller try them sequentially.
 */
export function buildGithubMarkdownUrls(pageUrl: string): string[] {
  let pathname: string;
  try {
    pathname = new URL(pageUrl).pathname;
  } catch {
    return [];
  }

  const section = extractSection(pathname);
  if (!section) return [];

  const repo = config.sectionRepoMap[section];
  if (!repo) return [];

  // Strip "/commerce/<section>/" prefix → "rest"
  const prefix = `/commerce/${section}`;
  let rest = pathname.startsWith(prefix)
    ? pathname.slice(prefix.length)
    : pathname;

  // Normalize: drop leading + trailing slash
  rest = rest.replace(/^\/+/, "").replace(/\/+$/, "");

  const base = `https://raw.githubusercontent.com/${repo.repo}/${repo.branch}/src/pages`;

  if (rest === "") {
    return [`${base}/index.md`];
  }

  // Try `rest.md` first, then `rest/index.md`. URLs that already end with a
  // trailing slash (the sitemap has both forms) get the index variant first.
  const trailingSlash = pathname.endsWith("/");
  const leafCandidate = `${base}/${rest}.md`;
  const indexCandidate = `${base}/${rest}/index.md`;

  return trailingSlash
    ? [indexCandidate, leafCandidate]
    : [leafCandidate, indexCandidate];
}

// --- Fetching ---

const FETCH_HEADERS = { "User-Agent": config.userAgent };

async function tryFetchGithubMarkdown(url: string): Promise<string | null> {
  const candidates = buildGithubMarkdownUrls(url);
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, {
        headers: FETCH_HEADERS,
        redirect: "follow",
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (text.length > 0) return text;
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function fetchAndParseHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { ...FETCH_HEADERS, Accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch page: ${res.status} ${res.statusText}`);
  }
  return extractMainContent(await res.text());
}

// --- HTML → Markdown conversion (fallback path) ---

function extractMainContent(html: string): string {
  let content = html;
  const mainMatch =
    content.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ??
    content.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ??
    content.match(
      /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    );

  if (mainMatch) content = mainMatch[1];

  return content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n")
    .replace(
      /<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
      "\n```\n$1\n```\n",
    )
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<\/?[uo]l[^>]*>/gi, "\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// --- MDX cleanup (developer.adobe.com source files) ---

/**
 * Strip Adobe's MDX-specific syntax that doesn't render as plain markdown.
 * Keeps the title from frontmatter (promoted to a `# Title` heading if the
 * body doesn't already start with one) and drops everything else.
 */
export function cleanMdx(raw: string): string {
  let out = raw;

  // 1) Strip YAML frontmatter (--- ... ---), capturing title for later
  let title: string | null = null;
  const frontmatterMatch = out.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  if (frontmatterMatch) {
    const block = frontmatterMatch[1];
    const titleLine = block.match(/^title:\s*(.+)$/m);
    if (titleLine) {
      title = titleLine[1]
        .trim()
        .replace(/^["']|["']$/g, "")
        .trim();
    }
    out = out.slice(frontmatterMatch[0].length);
  }

  // 2) Strip top-of-file ESM imports (`import X from '...'`)
  out = out.replace(/^\s*import\s+[^\n]*\n/gm, "");

  // 3) Strip ESM exports
  out = out.replace(/^\s*export\s+[^\n]*\n/gm, "");

  // 4) Replace common MDX/JSX components with their visible text content
  //    when possible, otherwise drop them.
  //
  // Self-closing JSX tags (`<InlineAlert ... />`, `<Image ... />`, etc.)
  out = out.replace(/<([A-Z][A-Za-z0-9]*)\b[^>]*\/>/g, "");

  // Paired JSX tags (`<CodeBlock ...>...</CodeBlock>`) — keep inner content
  out = out.replace(
    /<([A-Z][A-Za-z0-9]*)\b[^>]*>([\s\S]*?)<\/\1>/g,
    (_, _tag, inner) => inner,
  );

  // 5) Strip Markdown heading anchor IDs `{#some-id}` and Pandoc-style
  //    `{.class}` attributes.
  out = out.replace(/\{#[^}]+\}/g, "");
  out = out.replace(/\{\.[^}]+\}/g, "");

  // 6) Promote frontmatter title to an h1 if the body doesn't have one.
  if (title && !/^#\s/m.test(out)) {
    out = `# ${title}\n\n${out.trimStart()}`;
  }

  // 7) Collapse runs of 3+ blank lines down to 2.
  out = out.replace(/\n{3,}/g, "\n\n");

  return out.trim();
}

// --- Smart truncation (heading-boundary aware) ---

export function smartTruncate(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content;

  const lines = content.split("\n");
  let charCount = 0;
  let lastHeadingIdx = -1;
  let lastBlankIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    charCount += lines[i].length + 1;
    if (charCount > maxLen) break;
    if (/^#{1,6}\s/.test(lines[i])) lastHeadingIdx = i;
    if (lines[i].trim() === "") lastBlankIdx = i;
  }

  const threshold = lines.length * 0.3;
  const cutIdx =
    lastHeadingIdx > threshold
      ? lastHeadingIdx
      : lastBlankIdx > threshold
        ? lastBlankIdx
        : -1;

  if (cutIdx > 0) {
    const remaining = lines.length - cutIdx;
    return (
      lines.slice(0, cutIdx).join("\n").trim() +
      `\n\n... [truncated — ${remaining} more lines]`
    );
  }

  return content.substring(0, maxLen) + "\n\n... [content truncated]";
}

// --- Public: Fetch page content ---

async function fetchAndClean(url: string): Promise<string> {
  const md = await tryFetchGithubMarkdown(url);
  if (md) return cleanMdx(md);
  return fetchAndParseHtml(url);
}

export async function fetchPageContent(url: string): Promise<string> {
  const memoryCached = getFromMemoryCache(url);
  if (memoryCached) return memoryCached;

  const diskCached = await getFromDiskCache(url);
  if (diskCached) {
    const truncated = smartTruncate(diskCached, config.maxContentLength);
    const result = `Source: ${url}\n\n${truncated}`;
    setMemoryCache(url, result);
    return result;
  }

  const rawContent = await fetchAndClean(url);
  await setDiskCache(url, rawContent);

  const truncated = smartTruncate(rawContent, config.maxContentLength);
  const result = `Source: ${url}\n\n${truncated}`;
  setMemoryCache(url, result);
  return result;
}

export async function fetchRawContent(url: string): Promise<string> {
  const diskCached = await getFromDiskCache(url);
  if (diskCached) return diskCached;

  const rawContent = await fetchAndClean(url);
  await setDiskCache(url, rawContent);
  return rawContent;
}

// --- Public: Content extraction helpers ---

export function extractCodeExamples(
  markdown: string,
): { language: string; code: string }[] {
  const examples: { language: string; code: string }[] = [];
  const fenced = /```(\w*)\n([\s\S]*?)```/g;
  let m;
  while ((m = fenced.exec(markdown)) !== null) {
    const code = m[2].trim();
    if (code.length > 0) {
      examples.push({ language: m[1] || "text", code });
    }
  }
  return examples;
}

export function extractPageToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const heading = /^(#{1,6})\s+(.+)$/gm;
  let m;
  while ((m = heading.exec(markdown)) !== null) {
    entries.push({
      level: m[1].length,
      title: m[2].trim().replace(/[`*_]/g, ""),
    });
  }
  return entries;
}

export function extractStructuredContent(
  markdown: string,
): StructuredContent {
  const lines = markdown.split("\n");

  let title = "";
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) {
      title = h1[1].trim();
      break;
    }
  }

  let foundTitle = false;
  const descParts: string[] = [];
  for (const line of lines) {
    if (!foundTitle) {
      if (/^#\s/.test(line)) foundTitle = true;
      continue;
    }
    if (line.trim() === "") {
      if (descParts.length > 0) break;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) break;
    descParts.push(line);
  }
  const description = descParts.join(" ").trim();

  const sections: { heading: string; content: string }[] = [];
  let curHeading = "";
  let curLines: string[] = [];
  for (const line of lines) {
    const hm = line.match(/^(#{2,4})\s+(.+)$/);
    if (hm) {
      if (curHeading) {
        sections.push({
          heading: curHeading,
          content: curLines.join("\n").trim(),
        });
      }
      curHeading = hm[2].trim();
      curLines = [];
    } else if (curHeading) {
      curLines.push(line);
    }
  }
  if (curHeading) {
    sections.push({ heading: curHeading, content: curLines.join("\n").trim() });
  }

  const codeExamples = extractCodeExamples(markdown);

  const relatedLinks: { text: string; url: string }[] = [];
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let lm;
  while ((lm = linkRe.exec(markdown)) !== null) {
    const text = lm[1].trim();
    const url = lm[2].trim();
    if (text && url && !url.includes("#")) {
      relatedLinks.push({ text, url });
    }
  }

  return { title, description, sections, codeExamples, relatedLinks };
}
