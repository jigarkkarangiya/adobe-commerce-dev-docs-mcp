# Adobe Commerce Developer Docs MCP Server

[![npm version](https://img.shields.io/npm/v/adobe-commerce-dev-docs-mcp)](https://www.npmjs.com/package/adobe-commerce-dev-docs-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that gives AI assistants direct access to the official **Adobe Commerce / Magento _developer_ documentation** at [developer.adobe.com/commerce](https://developer.adobe.com/commerce/). It indexes the developer.adobe.com sitemap (~2,374 dev pages across 11 sections) and serves clean markdown by fetching directly from the underlying `AdobeDocs/commerce-*` GitHub repos — so you get exactly what the docs source contains, with no HTML noise.

> **Sibling project:** [`adobe-commerce-docs-mcp`](https://www.npmjs.com/package/adobe-commerce-docs-mcp) covers the **product/admin/cloud/operations** docs at experienceleague.adobe.com. This package covers the **developer** docs at developer.adobe.com. They're complementary — install both for full coverage.

---

## Features

- **9 tools** — search, read pages, browse sections, find related docs, extract code examples, get page TOC, lookup dev topics, multi-query search, and refresh
- **MCP Resources** — browsable `commerce-dev://` URIs for sections and doc pages
- **MCP Prompts** — reusable workflows for module scaffolding, GraphQL query building, extensibility decision-making, and MFTF test scaffolding
- **GitHub-source markdown** — fetches the raw `.md` source from `AdobeDocs/commerce-*` repos for clean, precise content (no HTML scraping)
- **MDX cleanup** — strips frontmatter, `<InlineAlert/>`, ESM imports, anchor IDs, and other MDX-specific syntax
- **BM25 search** — relevance-ranked results with IDF weighting and document-length normalization
- **Synonym expansion** — `graphql ↔ gql`, `webhook ↔ events`, `plugin ↔ interceptor`, `appbuilder ↔ extensibility`, `mftf ↔ testing`, and 50+ more
- **Fuzzy matching** — tolerates typos like `dependancy → dependency`, `compsoer → composer`
- **Smart truncation** — cuts at heading boundaries instead of mid-sentence
- **Persistent cache** — disk cache for both sitemap (24h) and page content (7 days), survives restarts
- **HTTP transport** — `--http` flag for remote/team deployment via Streamable HTTP
- **Docker ready** — multi-stage Dockerfile for containerized deployment
- **Configurable** — all settings tunable via environment variables (including per-section GitHub repo + branch overrides)

---

## Tools

### `search_adobe_commerce_dev_docs`

BM25-ranked search across all developer docs with synonym expansion and fuzzy matching.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | Search keywords (e.g., `"dependency injection"`, `"graphql product query"`, `"mftf test"`) |
| `limit` | number | No | Max results (1–50, default: 15) |
| `section` | string | No | Filter by section slug (see [Available Sections](#available-sections)) |

### `get_dev_doc_content`

Fetch the full content of a developer docs page as clean markdown. Pulls from the source GitHub repo when available, with HTML fallback.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | Yes | Full URL of the doc page from search results |

### `get_dev_code_examples`

Extract only the code blocks from a documentation page. Returns fenced code snippets without surrounding prose — much more token-efficient than fetching the full page.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | Yes | Full URL of the doc page |

### `get_dev_page_toc`

Get the heading hierarchy (table of contents) of a page. Useful for understanding structure before fetching the full content.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | Yes | Full URL of the doc page |

### `get_related_dev_docs`

Find sibling/related pages in the same section of the documentation tree.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | Yes | Full URL of the doc page |
| `limit` | number | No | Max related pages (1–30, default: 10) |

### `lookup_dev_topic`

Look up a developer topic, API name, module name, or class reference (e.g. `Magento_Catalog`, `CartItemInterface`, `storeConfig query`). Auto-fetches the top result for an immediate answer.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `topic` | string | Yes | Topic, API name, module name, or class reference |
| `section` | string | No | Optional section to scope the lookup |

### `multi_dev_page_search`

Search with multiple queries in one call. Returns de-duplicated results — reduces round-trips when researching from multiple angles.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `queries` | string[] | Yes | Array of search queries (1–5) |
| `limit_per_query` | number | No | Max results per query (1–20, default: 5) |
| `section` | string | No | Optional section filter for all queries |

### `list_dev_doc_sections`

List all available developer documentation sections with page counts. No parameters.

### `refresh_dev_sitemap`

Force-refresh the cached sitemap data. No parameters.

### Available Sections

Use these slugs with the `section` parameter:

| Section Slug | Description | Pages |
|---|---|---|
| `php` | PHP Developer Guide — modules, plugins, observers, DI, architecture, module reference | ~870 |
| `webapi` | REST + GraphQL APIs — schema, queries, mutations, authentication | ~510 |
| `frontend-core` | Frontend Developer Guide — themes, layouts, UI components, JS, CSS | ~260 |
| `pwa-studio` | PWA Studio — Peregrine, Venia, Buildpack | ~230 |
| `extensibility` | App Builder, webhooks, events, Admin UI SDK, observability | ~200 |
| `testing` | Magento Functional Testing Framework (MFTF) and integration tests | ~85 |
| `marketplace` | Submitting and publishing extensions to the Adobe Marketplace | ~65 |
| `admin-developer` | Admin development — admin grids, forms, system config | ~50 |
| `services` | Adobe Commerce SaaS services and shared service APIs | ~40 |
| `cloud-tools` | Magento Cloud CLI, ECE tools, deploy hooks | ~25 |
| `contributor` | Contribution guide for Magento Open Source | ~25 |

---

## Resources

MCP Resources let AI clients browse data directly via URIs — no tool call needed.

| URI | Description |
|---|---|
| `commerce-dev://sections` | All developer documentation sections with page counts |
| `commerce-dev://stats` | Server status: version, uptime, index size |
| `commerce-dev://docs/{section}` | Browse all pages within a section (supports autocomplete) |

---

## Prompts

MCP Prompts are reusable workflows that work across all MCP clients (Cursor, Claude Desktop, VS Code, Windsurf, etc.).

| Prompt | Arguments | Description |
|---|---|---|
| `commerce-module-scaffold` | `module_name`, `purpose` | Find module-structure docs and generate `registration.php` + `module.xml` boilerplate |
| `commerce-graphql-query-helper` | `intent` | Find the relevant GraphQL schema docs and craft a query/mutation with sample response |
| `commerce-extensibility-recipe` | `use_case` | Pick the right App Builder pattern (webhook vs event vs Admin UI SDK) for a use case |
| `commerce-mftf-test-helper` | `feature` | Scaffold an MFTF test from the testing docs (test XML + data entities + action groups) |

---

## Quick Setup for Cursor

### Option A: Automatic Setup Script (Linux / macOS)

If you have the repo cloned:

```bash
bash setup-cursor.sh
```

The script will:
- Check that Node.js 18+ is installed
- Create or update your `~/.cursor/mcp.json`
- Tell you to restart Cursor

### Option B: Manual Setup (All Platforms — 3 Steps)

#### Prerequisites

You need **Node.js 18+** installed. Check by running:

```bash
node --version
```

If you don't have it, install from [nodejs.org](https://nodejs.org/).

#### Step 1: Open MCP Settings in Cursor

1. Open **Cursor**
2. Go to **Settings** (gear icon in bottom-left, or `Ctrl + ,` / `Cmd + ,`)
3. In the left sidebar, click **"MCP"**
4. Click **"+ Add new MCP server"**

#### Step 2: Add the Server

A dialog will appear. Fill it in:

| Field | Value |
|---|---|
| **Name** | `adobe-commerce-dev-docs` |
| **Type** | `command` |
| **Command** | `npx -y adobe-commerce-dev-docs-mcp` |

Click **"Add"**.

#### Step 3: Verify

You should see `adobe-commerce-dev-docs` in your MCP list with a **green dot** (active).

Open any chat in **Agent mode** and try:

> *"Search Adobe Commerce dev docs for dependency injection"*

### Option C: Edit Config File Directly

Open (or create) the MCP config file:

| OS | Path |
|---|---|
| **Linux** | `~/.cursor/mcp.json` |
| **macOS** | `~/.cursor/mcp.json` |
| **Windows** | `%USERPROFILE%\.cursor\mcp.json` |

Add this JSON (if the file already has other servers, merge the `adobe-commerce-dev-docs` block into the existing `mcpServers` object):

```json
{
  "mcpServers": {
    "adobe-commerce-dev-docs": {
      "command": "npx",
      "args": ["-y", "adobe-commerce-dev-docs-mcp"]
    }
  }
}
```

Restart Cursor after saving.

---

## Setup for Other Tools

### Claude Desktop

Add to your Claude Desktop config:

| OS | Config Path |
|---|---|
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Linux** | `~/.config/Claude/claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "adobe-commerce-dev-docs": {
      "command": "npx",
      "args": ["-y", "adobe-commerce-dev-docs-mcp"]
    }
  }
}
```

### VS Code / GitHub Copilot

Add to `.vscode/mcp.json` in your project root:

```json
{
  "servers": {
    "adobe-commerce-dev-docs": {
      "command": "npx",
      "args": ["-y", "adobe-commerce-dev-docs-mcp"]
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "adobe-commerce-dev-docs": {
      "command": "npx",
      "args": ["-y", "adobe-commerce-dev-docs-mcp"]
    }
  }
}
```

---

## Usage Examples

Once connected, just ask naturally in any AI chat:

| What You Ask | What Happens |
|---|---|
| *"How does dependency injection work in Magento 2?"* | BM25 search of `commerce/php` and reads top matches |
| *"Build a GraphQL query that fetches a product by SKU with custom attributes"* | Uses `commerce-graphql-query-helper` prompt — finds schema, drafts query |
| *"Scaffold a Vendor_BlogPosts module"* | Uses `commerce-module-scaffold` prompt — finds best practices, generates boilerplate |
| *"Should I use a webhook or an event for syncing new orders?"* | Uses `commerce-extensibility-recipe` prompt — compares patterns |
| *"Show me code examples from the MFTF action groups page"* | Extracts only code blocks (saves tokens) |
| *"What's the table of contents for the PWA Studio Peregrine guide?"* | Returns heading hierarchy |
| *"Find the module reference page for Magento_Catalog"* | Uses `lookup_dev_topic` — auto-fetches top match |
| *"Search for plugins, interceptors, and observers across Commerce dev docs"* | Multi-query search with synonym expansion |
| *"Get me the source markdown for the Admin UI SDK guide"* | Fetches clean source markdown straight from the GitHub repo |

---

## How It Works

```text
┌─────────────┐     ┌──────────────────────────┐     ┌────────────────────────────┐
│  AI Client   │────▶│  MCP Server (v1.0)        │────▶│  developer.adobe.com        │
│  (Cursor,    │◀────│                          │◀────│  sitemap.xml + HTML pages  │
│   Claude,    │     │  9 Tools                 │     │                            │
│   VS Code)   │     │  3 Resources             │     └────────────────────────────┘
│              │     │  4 Prompts               │                  │
└─────────────┘     └──────────────────────────┘                  ▼
                      │                              ┌────────────────────────────┐
                      │                              │  AdobeDocs/commerce-*       │
                      │                              │  GitHub repos (raw .md)    │
                      │                              └────────────────────────────┘
                      ├─ BM25 search with synonym expansion + fuzzy matching
                      ├─ Pre-warms sitemap on startup
                      ├─ Fetches source .md from GitHub raw (clean markdown)
                      ├─ HTML fallback when source markdown is missing
                      ├─ MDX cleanup (frontmatter, JSX components, anchors, imports)
                      ├─ Memory LRU cache: 100 pages, 1h TTL
                      ├─ Disk page cache: 7-day TTL (survives restarts)
                      └─ Disk sitemap cache: 24h TTL
```

1. On startup, fetches the developer.adobe.com sitemap and indexes all `/commerce/<section>/...` URLs
2. Builds an inverted index with BM25 scoring, synonym mappings, and document frequency stats
3. When you search, terms are expanded with synonyms and matched with fuzzy fallback for typos
4. When you ask for page content, the URL is mapped to its source markdown in the corresponding `AdobeDocs/commerce-*` GitHub repo (e.g., `commerce/php/development/` → `commerce-php/src/pages/development/index.md`)
5. The raw markdown is cleaned of MDX-only syntax (frontmatter, `<InlineAlert/>`, imports, anchor IDs) and returned
6. If the GitHub fetch fails (404, removed page, etc.), falls back to HTML scraping
7. Smart truncation cuts at heading boundaries instead of mid-sentence
8. Pages are cached on disk (7 days) and in memory (LRU, 100 pages, 1 hour)

---

## HTTP Transport

For team/remote deployment, run the server in HTTP mode:

```bash
npm run start:http
# or
npx adobe-commerce-dev-docs-mcp --http
```

This starts a Streamable HTTP server on port 3000 (configurable via `PORT` env var).

### Docker

```bash
docker build -t adobe-commerce-dev-docs-mcp .
docker run -p 3000:3000 adobe-commerce-dev-docs-mcp
```

---

## Configuration

All settings are configurable via environment variables:

| Variable | Default | Description |
|---|---|---|
| `SITEMAP_URL` | `https://developer.adobe.com/sitemap.xml` | Override sitemap source |
| `CACHE_DIR` | `~/.cache/adobe-commerce-dev-docs-mcp` | Cache directory path |
| `SITEMAP_CACHE_TTL_MS` | `86400000` (24h) | Sitemap cache lifetime |
| `PAGE_CACHE_MAX` | `100` | Max pages in memory LRU cache |
| `PAGE_CACHE_TTL_MS` | `3600000` (1h) | Memory cache page lifetime |
| `PAGE_DISK_CACHE_TTL_MS` | `604800000` (7d) | Disk cache page lifetime |
| `MAX_CONTENT_LENGTH` | `15000` | Max characters per page response |
| `MAX_CONCURRENT_FETCHES` | `5` | Concurrent sitemap fetches |
| `PORT` | `3000` | HTTP server port (with `--http`) |
| `LOG_LEVEL` | `info` | Log level: debug, info, warn, error |

### Per-section repo overrides

Each section's GitHub source repo + branch can be overridden so you can pin to a specific release branch (e.g., 2.4.7 docs snapshot) or use a fork. Variables follow the pattern `SECTION_REPO_<SLUG_UPPER>_REPO` and `SECTION_REPO_<SLUG_UPPER>_BRANCH`:

```bash
# Pin PHP docs to the 2.4 branch
export SECTION_REPO_PHP_BRANCH=2.4

# Use your own fork for webapi docs
export SECTION_REPO_WEBAPI_REPO=my-org/commerce-webapi
export SECTION_REPO_WEBAPI_BRANCH=main
```

Hyphenated slugs become underscored: `frontend-core` → `SECTION_REPO_FRONTEND_CORE_REPO`, `admin-developer` → `SECTION_REPO_ADMIN_DEVELOPER_REPO`, etc.

---

## Troubleshooting

### MCP server failed to start

- Verify Node.js 18+ is installed: `node --version`
- Test the command manually in a terminal:
  ```bash
  npx -y adobe-commerce-dev-docs-mcp
  ```
- If you're behind a corporate proxy, ensure npm can reach the registry:
  ```bash
  npm config set registry https://registry.npmjs.org/
  ```

### Green dot doesn't appear in Cursor

- Click the **refresh icon** next to the server name in MCP settings
- Restart Cursor completely
- Check Cursor's Output panel for error messages

### "No results found" for searches

- The sitemap loads on first use (takes 30–90 seconds for the first run because it indexes ~2,300 pages). Wait and try again.
- Use broader keywords: `"webhook"` instead of `"webhook signature verification HMAC SHA-256"`
- Synonym expansion handles many aliases automatically (`gql` → `graphql`, `appbuilder` → `extensibility`, `events` → `webhook`, etc.)
- Ask the AI to run `refresh_dev_sitemap` to reload the latest data

### Page content looks empty or weird

- The MCP fetches source markdown from `AdobeDocs/commerce-*` GitHub repos. If the page was recently moved/renamed, the source path may have changed.
- The MCP automatically falls back to HTML scraping when the GitHub fetch fails — but Gatsby pages (webapi, extensibility, services) produce noisier HTML output.
- Clear caches: `rm -rf ~/.cache/adobe-commerce-dev-docs-mcp` then restart.

### Slow first response

- The first query triggers sitemap loading (~30–90 seconds for 2,300+ pages). Subsequent queries are instant.
- The sitemap is cached on disk for 24 hours, and page content is cached for 7 days, so restarts are fast.

---

## Development

### Run from Source

```bash
git clone https://github.com/jigarkkarangiya/adobe-commerce-dev-docs-mcp.git
cd adobe-commerce-dev-docs-mcp
npm install
npm run build
npm start
```

### Dev Mode (auto-reload)

```bash
npm run dev          # stdio transport
npm run dev:http     # HTTP transport
```

### Run Tests

```bash
npm test
```

### Project Structure

```text
adobe-commerce-dev-docs-mcp/
├── src/
│   ├── index.ts          # MCP server: tools, resources, prompts, transport
│   ├── sitemap.ts        # Sitemap loading, BM25 search, synonyms, fuzzy matching
│   ├── content.ts        # GitHub-raw markdown fetch, MDX cleanup, HTML fallback
│   └── config.ts         # Environment variable configuration + section→repo map
├── tests/
│   ├── search.test.ts    # Search, Levenshtein, synonym expansion, section extraction tests
│   └── content.test.ts   # MDX cleanup, URL→GitHub mapping, code/TOC extraction tests
├── dist/                 # Compiled JS (generated by `npm run build`)
├── Dockerfile            # Multi-stage Docker build for HTTP deployment
├── setup-cursor.sh       # One-command Cursor setup script
├── package.json
├── tsconfig.json
├── LICENSE
└── README.md
```

### Contributing

1. Fork the repo
2. Create a branch: `git checkout -b my-feature`
3. Make your changes
4. Build and test: `npm run build && npm test`
5. Commit and push
6. Open a Pull Request

---

## Requirements

- Node.js 18 or later

---

## Find This MCP

| Registry | Link |
|---|---|
| npm | [npmjs.com/package/adobe-commerce-dev-docs-mcp](https://www.npmjs.com/package/adobe-commerce-dev-docs-mcp) |
| GitHub | [github.com/jigarkkarangiya/adobe-commerce-dev-docs-mcp](https://github.com/jigarkkarangiya/adobe-commerce-dev-docs-mcp) |
| mcp.so | [mcp.so](https://mcp.so) — search `adobe-commerce-dev-docs` |
| Smithery | [smithery.ai](https://smithery.ai) — search `adobe-commerce-dev-docs` |
| Glama | [glama.ai/mcp/servers](https://glama.ai/mcp/servers) — search `adobe commerce developer` |

## Related MCPs

- [adobe-commerce-docs-mcp](https://github.com/jigarkkarangiya/adobe-commerce-docs-mcp) — Adobe Commerce merchant/user/admin docs (experienceleague.adobe.com)
- [aem-live-docs-mcp](https://github.com/jigarkkarangiya/aem-live-docs-mcp) — AEM / Edge Delivery Services docs (aem.live)

---

## License

[MIT](LICENSE)
