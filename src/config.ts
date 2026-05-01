import { join } from "node:path";
import { homedir } from "node:os";

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

function envStr(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

const cacheDir = envStr(
  "CACHE_DIR",
  join(homedir(), ".cache", "adobe-commerce-dev-docs-mcp"),
);

// Map from URL section slug (segment right after `/commerce/`) to the GitHub
// repo that hosts the source markdown. Pages on developer.adobe.com/commerce
// are built from `AdobeDocs/commerce-<slug>` repos under `src/pages/...`.
//
// Each repo can be overridden via env var so users can pin a specific branch
// (e.g. for 2.4.x doc snapshots) or fork.
//
// Example: SECTION_REPO_PHP_BRANCH=2.4.7 SECTION_REPO_PHP_REPO=AdobeDocs/commerce-php
export interface SectionRepo {
  repo: string;
  branch: string;
}

function repoFromEnv(slug: string, defaultRepo: string): SectionRepo {
  const upper = slug.toUpperCase().replace(/-/g, "_");
  return {
    repo: envStr(`SECTION_REPO_${upper}_REPO`, defaultRepo),
    branch: envStr(`SECTION_REPO_${upper}_BRANCH`, "main"),
  };
}

const sectionRepoMap: Record<string, SectionRepo> = {
  php: repoFromEnv("php", "AdobeDocs/commerce-php"),
  webapi: repoFromEnv("webapi", "AdobeDocs/commerce-webapi"),
  "frontend-core": repoFromEnv("frontend-core", "AdobeDocs/commerce-frontend-core"),
  "pwa-studio": repoFromEnv("pwa-studio", "AdobeDocs/commerce-pwa-studio"),
  extensibility: repoFromEnv("extensibility", "AdobeDocs/commerce-extensibility"),
  testing: repoFromEnv("testing", "AdobeDocs/commerce-testing"),
  marketplace: repoFromEnv("marketplace", "AdobeDocs/commerce-marketplace"),
  "admin-developer": repoFromEnv("admin-developer", "AdobeDocs/commerce-admin-developer"),
  services: repoFromEnv("services", "AdobeDocs/commerce-services"),
  "cloud-tools": repoFromEnv("cloud-tools", "AdobeDocs/commerce-cloud-tools"),
  contributor: repoFromEnv("contributor", "AdobeDocs/commerce-contributor"),
};

export const config = {
  version: "1.0.0",

  sitemapUrl: envStr(
    "SITEMAP_URL",
    "https://developer.adobe.com/sitemap.xml",
  ),

  cacheDir,
  sitemapCacheFile: join(cacheDir, "sitemap-cache.json"),
  pageCacheDir: join(cacheDir, "pages"),

  sitemapCacheTtlMs: envInt("SITEMAP_CACHE_TTL_MS", 24 * 60 * 60 * 1000),
  pageCacheMemoryMax: envInt("PAGE_CACHE_MAX", 100),
  pageCacheMemoryTtlMs: envInt("PAGE_CACHE_TTL_MS", 60 * 60 * 1000),
  pageCacheDiskTtlMs: envInt("PAGE_DISK_CACHE_TTL_MS", 7 * 24 * 60 * 60 * 1000),

  maxContentLength: envInt("MAX_CONTENT_LENGTH", 15000),
  maxConcurrentFetches: envInt("MAX_CONCURRENT_FETCHES", 5),

  httpPort: envInt("PORT", 3000),
  logLevel: envStr("LOG_LEVEL", "info") as "debug" | "info" | "warn" | "error",

  userAgent:
    "Mozilla/5.0 (compatible; AdobeCommerceDevDocsMCP/1.0; +https://github.com/jigarkkarangiya/adobe-commerce-dev-docs-mcp)",

  // URL prefixes that mark a page as part of the Commerce developer docs.
  // Used to filter the global developer.adobe.com sitemap down to ~2,374
  // dev-relevant URLs.
  commercePathPrefixes: [
    "/commerce/php",
    "/commerce/webapi",
    "/commerce/frontend-core",
    "/commerce/pwa-studio",
    "/commerce/extensibility",
    "/commerce/testing",
    "/commerce/marketplace",
    "/commerce/admin-developer",
    "/commerce/services",
    "/commerce/cloud-tools",
    "/commerce/contributor",
  ],

  sectionRepoMap,
};
