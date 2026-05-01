import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  searchEntries,
  levenshtein,
  expandWithSynonyms,
  extractSection,
  type DocEntry,
} from "../src/sitemap.js";

function makeEntry(path: string, title?: string): DocEntry {
  const segments = path
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(/-/g, " ").toLowerCase());
  return {
    url: `https://developer.adobe.com${path}`,
    lastmod: "2026-01-01",
    path,
    pathSegments: segments,
    title:
      title ??
      segments
        .slice(2)
        .map((s) => s.replace(/\b\w/g, (c) => c.toUpperCase()))
        .join(" > "),
    section: extractSection(path) ?? "",
  };
}

const testEntries: DocEntry[] = [
  makeEntry("/commerce/php/development/components/dependency-injection"),
  makeEntry("/commerce/php/development/components/plugins"),
  makeEntry("/commerce/php/architecture/modules/overview"),
  makeEntry("/commerce/webapi/graphql/queries/products"),
  makeEntry("/commerce/webapi/graphql/mutations/cart"),
  makeEntry("/commerce/webapi/rest/use-rest"),
  makeEntry("/commerce/extensibility/webhooks/index"),
  makeEntry("/commerce/extensibility/events/configure-commerce"),
  makeEntry("/commerce/testing/functional-testing-framework/test"),
  makeEntry("/commerce/frontend-core/guide/themes/inheritance"),
  makeEntry("/commerce/pwa-studio/guides/general-concepts/peregrine-hooks"),
];

describe("extractSection", () => {
  it("extracts section from full URL", () => {
    assert.equal(
      extractSection("https://developer.adobe.com/commerce/php/development/"),
      "php",
    );
  });

  it("extracts section from pathname", () => {
    assert.equal(extractSection("/commerce/webapi/graphql/usage/"), "webapi");
  });

  it("returns null for non-commerce paths", () => {
    assert.equal(extractSection("/express/hackathons/"), null);
    assert.equal(extractSection("/photoshop/api"), null);
  });

  it("handles hyphenated section slugs", () => {
    assert.equal(
      extractSection("/commerce/admin-developer/intro"),
      "admin-developer",
    );
    assert.equal(
      extractSection("/commerce/frontend-core/guide/"),
      "frontend-core",
    );
  });
});

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    assert.equal(levenshtein("hello", "hello"), 0);
  });

  it("computes correct distance for single edit", () => {
    assert.equal(levenshtein("cat", "car"), 1);
    assert.equal(levenshtein("cat", "cats"), 1);
  });

  it("handles empty strings", () => {
    assert.equal(levenshtein("", "abc"), 3);
    assert.equal(levenshtein("abc", ""), 3);
  });

  it("handles common dev typos", () => {
    assert.ok(levenshtein("graphqll", "graphql") <= 2);
    assert.ok(levenshtein("dependancy", "dependency") <= 2);
    assert.ok(levenshtein("compsoer", "composer") <= 2);
  });
});

describe("expandWithSynonyms", () => {
  it("expands graphql ↔ gql", () => {
    const result = expandWithSynonyms(["graphql"]);
    assert.ok(result.includes("graphql"));
    assert.ok(result.includes("gql"));
  });

  it("expands rest ↔ webapi", () => {
    const result = expandWithSynonyms(["rest"]);
    assert.ok(result.includes("webapi"));
  });

  it("expands webhook ↔ events", () => {
    const result = expandWithSynonyms(["webhook"]);
    assert.ok(result.includes("events"));
  });

  it("expands plugin ↔ interceptor", () => {
    const result = expandWithSynonyms(["plugin"]);
    assert.ok(result.includes("interceptor"));
  });

  it("expands appbuilder ↔ extensibility", () => {
    const result = expandWithSynonyms(["appbuilder"]);
    assert.ok(result.includes("extensibility"));
  });

  it("preserves unknown terms", () => {
    const result = expandWithSynonyms(["foobar"]);
    assert.deepEqual(result, ["foobar"]);
  });

  it("handles multiple terms", () => {
    const result = expandWithSynonyms(["module", "plugin"]);
    assert.ok(result.includes("module"));
    assert.ok(result.includes("extension"));
    assert.ok(result.includes("plugin"));
    assert.ok(result.includes("interceptor"));
  });
});

describe("searchEntries (linear scan mode)", () => {
  it("returns results for matching query", () => {
    const results = searchEntries(testEntries, "graphql", 10);
    assert.ok(results.length > 0);
    assert.ok(results.some((r) => r.entry.path.includes("graphql")));
  });

  it("ranks exact path matches higher", () => {
    const results = searchEntries(testEntries, "dependency injection", 10);
    assert.ok(results.length > 0);
    assert.ok(results[0].entry.path.includes("dependency-injection"));
  });

  it("returns empty for nonsense query", () => {
    const results = searchEntries(testEntries, "xyznonexistent", 10);
    assert.equal(results.length, 0);
  });

  it("respects limit", () => {
    const results = searchEntries(testEntries, "commerce", 3);
    assert.ok(results.length <= 3);
  });

  it("returns all entries for empty query", () => {
    const results = searchEntries(testEntries, "", 5);
    assert.equal(results.length, 5);
  });

  it("includes snippets in results", () => {
    const results = searchEntries(testEntries, "graphql", 5);
    assert.ok(results.length > 0);
    assert.ok(typeof results[0].snippet === "string");
    assert.ok(results[0].snippet.length > 0);
  });

  it("returns scored results sorted by score", () => {
    const results = searchEntries(testEntries, "webapi", 10);
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].score >= results[i].score);
    }
  });

  it("synonym expansion finds related results", () => {
    const results = searchEntries(testEntries, "gql", 10);
    assert.ok(
      results.some((r) => r.entry.path.includes("graphql")),
      "search for 'gql' should match 'graphql' pages via synonym expansion",
    );
  });
});
