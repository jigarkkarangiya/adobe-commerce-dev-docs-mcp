#!/usr/bin/env node

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import {
  loadSitemap,
  searchEntries,
  getDocSections,
  getSectionSlugs,
  getSectionEntries,
  getRelatedDocs,
  clearCache,
  type DocEntry,
} from "./sitemap.js";
import {
  fetchPageContent,
  fetchRawContent,
  extractCodeExamples,
  extractPageToc,
  clearMemoryCache,
} from "./content.js";

// ─── State ───────────────────────────────────────────────────────────────────

let docEntries: DocEntry[] = [];
let isLoaded = false;
let loadPromise: Promise<void> | null = null;
const startTime = Date.now();

function preWarm(): void {
  if (loadPromise) return;
  loadPromise = (async () => {
    try {
      docEntries = await loadSitemap();
      isLoaded = true;
      console.error(`Pre-warm complete: ${docEntries.length} pages indexed`);
    } catch (err) {
      console.error("Pre-warm failed, will retry on first tool call:", err);
      loadPromise = null;
    }
  })();
}

async function ensureLoaded(): Promise<void> {
  if (isLoaded) return;
  if (loadPromise) {
    await loadPromise;
    if (isLoaded) return;
  }
  docEntries = await loadSitemap();
  isLoaded = true;
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "adobe-commerce-dev-docs",
  version: config.version,
});

// ═══════════════════════════════════════════════════════════════════════════════
//  RESOURCES
// ═══════════════════════════════════════════════════════════════════════════════

server.resource(
  "sections",
  "commerce-dev://sections",
  {
    description:
      "All Adobe Commerce developer documentation sections with page counts",
    mimeType: "text/plain",
  },
  async () => {
    await ensureLoaded();
    const sections = getDocSections(docEntries);
    const sorted = [...sections.entries()].sort((a, b) => b[1] - a[1]);
    const text = sorted
      .map(([slug, count]) => {
        const label = slug
          .replace(/-/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        return `${label} (${slug}) — ${count} pages`;
      })
      .join("\n");

    return {
      contents: [
        {
          uri: "commerce-dev://sections",
          text: `Adobe Commerce Dev Docs — ${docEntries.length} total pages\n\n${text}`,
          mimeType: "text/plain",
        },
      ],
    };
  },
);

server.resource(
  "stats",
  "commerce-dev://stats",
  {
    description: "MCP server status: version, uptime, index size",
    mimeType: "application/json",
  },
  async () => {
    await ensureLoaded();
    const stats = {
      version: config.version,
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      total_pages_indexed: docEntries.length,
      sections: getDocSections(docEntries).size,
      loaded: isLoaded,
      sitemap_url: config.sitemapUrl,
    };
    return {
      contents: [
        {
          uri: "commerce-dev://stats",
          text: JSON.stringify(stats, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  },
);

server.resource(
  "section-docs",
  new ResourceTemplate("commerce-dev://docs/{section}", {
    list: async () => {
      await ensureLoaded();
      return {
        resources: getSectionSlugs(docEntries).map((slug) => ({
          uri: `commerce-dev://docs/${slug}`,
          name: slug
            .replace(/-/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase()),
          description: `Browse ${slug} developer documentation`,
          mimeType: "text/plain",
        })),
      };
    },
    complete: {
      section: async (value) => {
        await ensureLoaded();
        const slugs = getSectionSlugs(docEntries);
        return value
          ? slugs.filter((s) => s.startsWith(value.toLowerCase()))
          : slugs;
      },
    },
  }),
  {
    description: "Browse developer documentation pages within a section",
    mimeType: "text/plain",
  },
  async (uri, variables) => {
    await ensureLoaded();
    const section = variables.section as string;
    const entries = getSectionEntries(docEntries, section);

    if (entries.length === 0) {
      return {
        contents: [
          {
            uri: uri.href,
            text: `No pages found for section "${section}".`,
            mimeType: "text/plain",
          },
        ],
      };
    }

    const text = entries.map((e) => `- ${e.title}\n  ${e.url}`).join("\n");
    return {
      contents: [
        {
          uri: uri.href,
          text: `${section} — ${entries.length} pages:\n\n${text}`,
          mimeType: "text/plain",
        },
      ],
    };
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
//  PROMPTS  (dev-workflow oriented)
// ═══════════════════════════════════════════════════════════════════════════════

server.prompt(
  "commerce-module-scaffold",
  "Scaffold an Adobe Commerce / Magento module using best practices from official PHP docs",
  {
    module_name: z
      .string()
      .describe("Vendor_Module name (e.g., 'Acme_BlogPosts')"),
    purpose: z
      .string()
      .describe("Short description of what the module does"),
  },
  ({ module_name, purpose }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `Help me scaffold an Adobe Commerce / Magento 2 module:`,
            "",
            `- **Name:** \`${module_name}\``,
            `- **Purpose:** ${purpose}`,
            "",
            "1. Use `search_adobe_commerce_dev_docs` (section: `php`) to find module structure, registration, and `module.xml` best practices.",
            "2. Fetch the most relevant pages with `get_dev_doc_content`.",
            "3. Generate the boilerplate: `registration.php`, `etc/module.xml`, `composer.json`, base directory layout.",
            "4. Cite all source documentation links.",
          ].join("\n"),
        },
      },
    ],
  }),
);

server.prompt(
  "commerce-graphql-query-helper",
  "Build a GraphQL query/mutation against Adobe Commerce using the official schema docs",
  {
    intent: z
      .string()
      .describe(
        "What the GraphQL query should do (e.g., 'fetch product details by SKU with custom attributes')",
      ),
  },
  ({ intent }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `Help me build an Adobe Commerce GraphQL operation for this intent:`,
            "",
            `> ${intent}`,
            "",
            "1. Use `search_adobe_commerce_dev_docs` (section: `webapi`) to find the relevant query/mutation, type definitions, and required arguments.",
            "2. Fetch schema reference pages with `get_dev_doc_content` and code samples with `get_dev_code_examples`.",
            "3. Provide: **The complete GraphQL query**, **expected variables**, **example response shape**, and **REST API equivalent** (if applicable).",
            "4. Cite all source documentation links.",
          ].join("\n"),
        },
      },
    ],
  }),
);

server.prompt(
  "commerce-extensibility-recipe",
  "Pick the right App Builder extensibility pattern (webhook vs event vs Admin UI SDK) for a use case",
  {
    use_case: z
      .string()
      .describe(
        "What you're trying to build (e.g., 'sync new orders to my ERP', 'add a custom button to product grid')",
      ),
  },
  ({ use_case }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `I want to extend Adobe Commerce for this use case:`,
            "",
            `> ${use_case}`,
            "",
            "1. Use `search_adobe_commerce_dev_docs` (section: `extensibility`) to compare webhooks, events, App Builder, and Admin UI SDK approaches.",
            "2. Fetch the most relevant decision guides with `get_dev_doc_content`.",
            "3. Recommend: **Best-fit pattern**, **why** (with trade-offs), **starter code/snippets** from the docs, **next steps**.",
            "4. Cite all source documentation links.",
          ].join("\n"),
        },
      },
    ],
  }),
);

server.prompt(
  "commerce-mftf-test-helper",
  "Scaffold a Magento Functional Testing Framework (MFTF) test from the testing docs",
  {
    feature: z
      .string()
      .describe(
        "Feature/flow to test (e.g., 'guest checkout for simple product')",
      ),
  },
  ({ feature }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `Help me write an MFTF test for:`,
            "",
            `> ${feature}`,
            "",
            "1. Use `search_adobe_commerce_dev_docs` (section: `testing`) to find MFTF reference for actions, data, selectors, and metadata.",
            "2. Fetch the most relevant pages with `get_dev_doc_content` and code examples with `get_dev_code_examples`.",
            "3. Produce: **Test XML scaffold**, **required `<data>` entities**, **action group references**, **suggested directory placement**.",
            "4. Cite all source documentation links.",
          ].join("\n"),
        },
      },
    ],
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
//  TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "search_adobe_commerce_dev_docs",
  "Search Adobe Commerce / Magento DEVELOPER documentation (developer.adobe.com/commerce). Returns pages ranked by BM25 relevance with snippets. Supports synonym expansion (e.g. 'graphql' also matches 'gql', 'webhook' also matches 'events') and fuzzy matching for typos.",
  {
    query: z
      .string()
      .describe(
        "Search keywords (e.g., 'dependency injection', 'graphql product query', 'mftf test', 'webhook signature')",
      ),
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(15)
      .describe("Max results (default: 15)"),
    section: z
      .string()
      .optional()
      .describe(
        "Filter by section slug (e.g., 'php', 'webapi', 'extensibility', 'testing', 'frontend-core', 'pwa-studio', 'admin-developer', 'marketplace', 'services', 'cloud-tools', 'contributor')",
      ),
  },
  async ({ query, limit, section }) => {
    try {
      await ensureLoaded();

      const pool = section
        ? getSectionEntries(docEntries, section)
        : docEntries;
      const results = searchEntries(pool, query, limit);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No results for "${query}"${section ? ` in "${section}"` : ""}. Try broader keywords or remove the section filter.`,
            },
          ],
        };
      }

      const formatted = results
        .map(
          (r, i) =>
            `${i + 1}. **${r.entry.title}** [${r.entry.section}]\n   URL: ${r.entry.url}\n   ${r.snippet}\n   Updated: ${r.entry.lastmod}`,
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${results.length} results for "${query}":\n\n${formatted}\n\nUse \`get_dev_doc_content\` with a URL to read the full page.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "get_dev_doc_content",
  "Fetch the full content of an Adobe Commerce developer documentation page as clean markdown. Pulls the source markdown directly from the underlying AdobeDocs/commerce-* GitHub repo when available, with HTML fallback.",
  {
    url: z
      .string()
      .url()
      .describe("Full URL of the developer documentation page"),
  },
  async ({ url }) => {
    try {
      const content = await fetchPageContent(url);
      return { content: [{ type: "text" as const, text: content }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "list_dev_doc_sections",
  "List all Adobe Commerce developer documentation sections with page counts.",
  {},
  async () => {
    try {
      await ensureLoaded();
      const sections = getDocSections(docEntries);
      const sorted = [...sections.entries()].sort((a, b) => b[1] - a[1]);
      const formatted = sorted
        .map(([slug, count]) => {
          const label = slug
            .replace(/-/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
          return `- **${label}** (\`${slug}\`) — ${count} pages`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Adobe Commerce Developer Documentation (${docEntries.length} pages):\n\n${formatted}\n\nUse the slug with \`search_adobe_commerce_dev_docs\` section parameter.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "refresh_dev_sitemap",
  "Force-refresh the cached sitemap data from developer.adobe.com.",
  {},
  async () => {
    try {
      isLoaded = false;
      loadPromise = null;
      docEntries = [];
      clearMemoryCache();
      await clearCache();
      await ensureLoaded();

      return {
        content: [
          {
            type: "text" as const,
            text: `Sitemap refreshed. ${docEntries.length} pages indexed.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "get_related_dev_docs",
  "Find sibling/related developer documentation pages for a given page URL (same parent in the doc tree).",
  {
    url: z
      .string()
      .url()
      .describe("Full URL of the developer documentation page"),
    limit: z
      .number()
      .min(1)
      .max(30)
      .default(10)
      .describe("Max related pages (default: 10)"),
  },
  async ({ url, limit }) => {
    try {
      await ensureLoaded();
      const related = getRelatedDocs(docEntries, url, limit);

      if (related.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No related pages found for ${url}.`,
            },
          ],
        };
      }

      const formatted = related
        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}`)
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `${related.length} related pages:\n\n${formatted}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "get_dev_code_examples",
  "Extract only code examples from a developer documentation page. Returns fenced code blocks without prose — much more token-efficient than full page fetch when you only need snippets (PHP, XML, GraphQL, JS, Bash, etc.).",
  {
    url: z
      .string()
      .url()
      .describe("Full URL of the developer documentation page"),
  },
  async ({ url }) => {
    try {
      const raw = await fetchRawContent(url);
      const examples = extractCodeExamples(raw);

      if (examples.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No code examples found on ${url}.`,
            },
          ],
        };
      }

      const formatted = examples
        .map(
          (ex, i) =>
            `### Example ${i + 1}${ex.language !== "text" ? ` (${ex.language})` : ""}\n\`\`\`${ex.language}\n${ex.code}\n\`\`\``,
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `${examples.length} code example(s) from ${url}:\n\n${formatted}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "get_dev_page_toc",
  "Get the table of contents (heading hierarchy) of a developer documentation page. Useful for understanding structure before fetching the full (expensive) content.",
  {
    url: z
      .string()
      .url()
      .describe("Full URL of the developer documentation page"),
  },
  async ({ url }) => {
    try {
      const raw = await fetchRawContent(url);
      const toc = extractPageToc(raw);

      if (toc.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No headings found on ${url}.`,
            },
          ],
        };
      }

      const formatted = toc
        .map((h) => `${"  ".repeat(h.level - 1)}- ${h.title}`)
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Table of Contents — ${url}:\n\n${formatted}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "lookup_dev_topic",
  "Look up a developer topic, API name, module name, or class reference (e.g., 'Magento_Catalog', 'CartItemInterface', 'storeConfig query'). Auto-fetches the top result for an immediate answer.",
  {
    topic: z
      .string()
      .describe(
        "Topic, API name, module name, or class reference (e.g., 'Magento_Catalog', 'CartItemInterface', 'storeConfig query')",
      ),
    section: z
      .string()
      .optional()
      .describe(
        "Optional section to scope the lookup (e.g., 'php' for module-reference, 'webapi' for API/schema)",
      ),
  },
  async ({ topic, section }) => {
    try {
      await ensureLoaded();

      const pool = section
        ? getSectionEntries(docEntries, section)
        : docEntries;
      let results = searchEntries(pool, topic, 5);

      if (results.length === 0 && section) {
        results = searchEntries(docEntries, topic, 5);
      }

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No documentation found for "${topic}". Try different keywords or remove the section filter.`,
            },
          ],
        };
      }

      let pageContent = "";
      try {
        pageContent = await fetchPageContent(results[0].entry.url);
      } catch {
        // non-critical — fall back to listing
      }

      const others = results
        .slice(1)
        .map((r, i) => `${i + 2}. **${r.entry.title}**\n   ${r.entry.url}`)
        .join("\n\n");

      const text = pageContent
        ? `## ${results[0].entry.title}\n\n${pageContent}${others ? `\n\n---\n\n## Other Matches\n\n${others}` : ""}`
        : results
            .map(
              (r, i) =>
                `${i + 1}. **${r.entry.title}**\n   ${r.entry.url}\n   ${r.snippet}`,
            )
            .join("\n\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "multi_dev_page_search",
  "Search developer documentation with multiple queries at once. Returns de-duplicated results from all queries — reduces round-trips when researching a topic from multiple angles.",
  {
    queries: z
      .array(z.string())
      .min(1)
      .max(5)
      .describe("Array of search queries (1–5)"),
    limit_per_query: z
      .number()
      .min(1)
      .max(20)
      .default(5)
      .describe("Max results per query (default: 5)"),
    section: z
      .string()
      .optional()
      .describe("Optional section filter for all queries"),
  },
  async ({ queries, limit_per_query, section }) => {
    try {
      await ensureLoaded();

      const pool = section
        ? getSectionEntries(docEntries, section)
        : docEntries;
      const seen = new Set<string>();
      const blocks: string[] = [];

      for (const q of queries) {
        const results = searchEntries(pool, q, limit_per_query);
        const unique = results.filter((r) => !seen.has(r.entry.url));
        unique.forEach((r) => seen.add(r.entry.url));

        if (unique.length > 0) {
          const list = unique
            .map(
              (r, i) =>
                `  ${i + 1}. **${r.entry.title}**\n     ${r.entry.url}\n     ${r.snippet}`,
            )
            .join("\n");
          blocks.push(`### "${q}" (${unique.length} results)\n\n${list}`);
        } else {
          blocks.push(`### "${q}"\n\n  No results.`);
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Multi-search — ${seen.size} unique pages:\n\n${blocks.join("\n\n")}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
//  TRANSPORT & MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function startHttpTransport(): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  await server.connect(transport);

  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, DELETE, OPTIONS",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, mcp-session-id",
      );

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      try {
        await transport.handleRequest(req, res);
      } catch (err) {
        console.error("HTTP error:", err);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end("Internal Server Error");
        }
      }
    },
  );

  httpServer.listen(config.httpPort, () => {
    console.error(
      `Adobe Commerce Dev Docs MCP running on http://localhost:${config.httpPort}`,
    );
  });
}

async function startStdioTransport(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Adobe Commerce Dev Docs MCP server running on stdio");
}

async function main(): Promise<void> {
  const useHttp = process.argv.includes("--http");

  if (useHttp) {
    await startHttpTransport();
  } else {
    await startStdioTransport();
  }

  preWarm();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
