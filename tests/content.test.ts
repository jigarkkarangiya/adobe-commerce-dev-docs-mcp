import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractCodeExamples,
  extractPageToc,
  extractStructuredContent,
  smartTruncate,
  cleanMdx,
  buildGithubMarkdownUrls,
} from "../src/content.js";

const SAMPLE_MARKDOWN = `# Dependency Injection

This guide explains how to use dependency injection in Adobe Commerce.

## Constructor Injection

Always inject dependencies via the constructor:

\`\`\`php
public function __construct(
    private readonly LoggerInterface $logger,
    private readonly ProductRepository $productRepository,
) {
}
\`\`\`

## Configuring Types

Configure the DI in \`etc/di.xml\`:

\`\`\`xml
<config>
    <type name="Acme\\Module\\Model\\Foo">
        <arguments>
            <argument name="logger" xsi:type="object">Psr\\Log\\LoggerInterface</argument>
        </arguments>
    </type>
</config>
\`\`\`

### Plugins

Plugins (interceptors) wrap public methods.

## Related Links

See [Module Reference](https://developer.adobe.com/commerce/php/module-reference) and
[Plugins Guide](https://developer.adobe.com/commerce/php/development/components/plugins).
`;

describe("extractCodeExamples", () => {
  it("extracts fenced code blocks with languages", () => {
    const examples = extractCodeExamples(SAMPLE_MARKDOWN);
    assert.equal(examples.length, 2);
    assert.equal(examples[0].language, "php");
    assert.ok(examples[0].code.includes("LoggerInterface"));
    assert.equal(examples[1].language, "xml");
    assert.ok(examples[1].code.includes("<type"));
  });

  it("returns empty array for markdown with no code", () => {
    const examples = extractCodeExamples("# Hello\n\nNo code here.");
    assert.equal(examples.length, 0);
  });

  it("handles code blocks without language tag", () => {
    const md = "```\nplain code\n```";
    const examples = extractCodeExamples(md);
    assert.equal(examples.length, 1);
    assert.equal(examples[0].language, "text");
  });
});

describe("extractPageToc", () => {
  it("extracts heading hierarchy", () => {
    const toc = extractPageToc(SAMPLE_MARKDOWN);
    assert.ok(toc.length >= 4);
    assert.equal(toc[0].level, 1);
    assert.equal(toc[0].title, "Dependency Injection");
    assert.equal(toc[1].level, 2);
    assert.equal(toc[1].title, "Constructor Injection");
  });

  it("includes nested headings", () => {
    const toc = extractPageToc(SAMPLE_MARKDOWN);
    const nested = toc.find((h) => h.title === "Plugins");
    assert.ok(nested);
    assert.equal(nested!.level, 3);
  });

  it("returns empty for no headings", () => {
    const toc = extractPageToc("Just plain text\nwith no headings.");
    assert.equal(toc.length, 0);
  });
});

describe("extractStructuredContent", () => {
  it("extracts title from h1", () => {
    const sc = extractStructuredContent(SAMPLE_MARKDOWN);
    assert.equal(sc.title, "Dependency Injection");
  });

  it("extracts description from first paragraph", () => {
    const sc = extractStructuredContent(SAMPLE_MARKDOWN);
    assert.ok(sc.description.includes("dependency injection"));
  });

  it("extracts sections from h2/h3 headings", () => {
    const sc = extractStructuredContent(SAMPLE_MARKDOWN);
    assert.ok(sc.sections.length >= 3);
    assert.equal(sc.sections[0].heading, "Constructor Injection");
  });

  it("extracts code examples", () => {
    const sc = extractStructuredContent(SAMPLE_MARKDOWN);
    assert.equal(sc.codeExamples.length, 2);
  });

  it("extracts related links", () => {
    const sc = extractStructuredContent(SAMPLE_MARKDOWN);
    assert.ok(sc.relatedLinks.length >= 2);
    assert.ok(sc.relatedLinks.some((l) => l.text === "Module Reference"));
  });
});

describe("smartTruncate", () => {
  it("returns content unchanged if under limit", () => {
    const short = "Hello world";
    assert.equal(smartTruncate(short, 1000), short);
  });

  it("truncates long content with indicator", () => {
    const long = "a".repeat(100);
    const result = smartTruncate(long, 50);
    assert.ok(result.length < 100 + 50);
    assert.ok(result.includes("truncated"));
  });

  it("prefers heading boundaries for truncation", () => {
    const content = [
      "# Title",
      "",
      "Some intro text here that is long enough.",
      "",
      "## Section 1",
      "",
      "Content for section 1.",
      "",
      "## Section 2",
      "",
      "Content for section 2 that we want to cut.",
      "",
      "## Section 3",
      "",
      "More content after the cut point.",
    ].join("\n");

    const result = smartTruncate(content, content.length - 40);
    assert.ok(result.includes("truncated"));
    assert.ok(!result.includes("Section 3") || result.includes("truncated"));
  });
});

describe("cleanMdx", () => {
  it("strips YAML frontmatter and promotes title to h1", () => {
    const input = `---
title: Dependency Injection
description: Learn DI in Magento
keywords:
  - DI
  - Magento
---

The body of the page goes here.
`;
    const result = cleanMdx(input);
    assert.ok(!result.includes("---"));
    assert.ok(!result.includes("description:"));
    assert.ok(result.startsWith("# Dependency Injection"));
    assert.ok(result.includes("body of the page"));
  });

  it("keeps existing h1 when frontmatter present", () => {
    const input = `---
title: Foo
---

# Body Title

Some content.
`;
    const result = cleanMdx(input);
    assert.ok(result.includes("# Body Title"));
    assert.ok(!result.includes("# Foo"));
  });

  it("strips self-closing JSX tags like <InlineAlert />", () => {
    const input = `Some text.

<InlineAlert variant="info" slots="text"/>

You must follow PSR-4.

<Image src="foo.png" alt="bar" />

End.`;
    const result = cleanMdx(input);
    assert.ok(!result.includes("<InlineAlert"));
    assert.ok(!result.includes("<Image"));
    assert.ok(result.includes("Some text."));
    assert.ok(result.includes("You must follow PSR-4."));
  });

  it("strips paired JSX tags but keeps inner content", () => {
    const input = `Before.

<CodeBlock title="example">
This is the inner content.
</CodeBlock>

After.`;
    const result = cleanMdx(input);
    assert.ok(!result.includes("<CodeBlock"));
    assert.ok(!result.includes("</CodeBlock>"));
    assert.ok(result.includes("This is the inner content."));
  });

  it("strips ESM imports and exports", () => {
    const input = `import Foo from '../components/Foo';
import { Bar } from './Bar';
export const meta = { title: 'x' };

# Hello

Body.
`;
    const result = cleanMdx(input);
    assert.ok(!result.includes("import"));
    assert.ok(!result.includes("export"));
    assert.ok(result.includes("# Hello"));
  });

  it("strips heading anchor IDs like {#some-id}", () => {
    const input = `## Section Heading {#section-anchor}

Body.
`;
    const result = cleanMdx(input);
    assert.ok(!result.includes("{#section-anchor}"));
    assert.ok(result.includes("## Section Heading"));
  });

  it("collapses excessive blank lines", () => {
    const input = "Line 1\n\n\n\n\nLine 2";
    const result = cleanMdx(input);
    assert.ok(!/\n{3,}/.test(result));
  });
});

describe("buildGithubMarkdownUrls", () => {
  it("maps trailing-slash URL to index.md candidate first", () => {
    const urls = buildGithubMarkdownUrls(
      "https://developer.adobe.com/commerce/php/development/",
    );
    assert.ok(urls.length >= 1);
    assert.equal(
      urls[0],
      "https://raw.githubusercontent.com/AdobeDocs/commerce-php/main/src/pages/development/index.md",
    );
  });

  it("maps non-trailing-slash URL to .md candidate first", () => {
    const urls = buildGithubMarkdownUrls(
      "https://developer.adobe.com/commerce/php/architecture/modules/overview",
    );
    assert.ok(urls.length >= 1);
    assert.equal(
      urls[0],
      "https://raw.githubusercontent.com/AdobeDocs/commerce-php/main/src/pages/architecture/modules/overview.md",
    );
    assert.equal(
      urls[1],
      "https://raw.githubusercontent.com/AdobeDocs/commerce-php/main/src/pages/architecture/modules/overview/index.md",
    );
  });

  it("maps webapi URL to commerce-webapi repo", () => {
    const urls = buildGithubMarkdownUrls(
      "https://developer.adobe.com/commerce/webapi/graphql/usage/",
    );
    assert.equal(
      urls[0],
      "https://raw.githubusercontent.com/AdobeDocs/commerce-webapi/main/src/pages/graphql/usage/index.md",
    );
  });

  it("maps pwa-studio URL to commerce-pwa-studio repo", () => {
    const urls = buildGithubMarkdownUrls(
      "https://developer.adobe.com/commerce/pwa-studio/guides/general-concepts/peregrine-hooks/",
    );
    assert.ok(
      urls[0].startsWith(
        "https://raw.githubusercontent.com/AdobeDocs/commerce-pwa-studio/main/src/pages/",
      ),
    );
  });

  it("maps section root URL to top-level index.md", () => {
    const urls = buildGithubMarkdownUrls(
      "https://developer.adobe.com/commerce/php/",
    );
    assert.equal(
      urls[0],
      "https://raw.githubusercontent.com/AdobeDocs/commerce-php/main/src/pages/index.md",
    );
  });

  it("returns empty list for non-commerce URL", () => {
    const urls = buildGithubMarkdownUrls(
      "https://developer.adobe.com/express/hackathons/",
    );
    assert.deepEqual(urls, []);
  });

  it("returns empty list for unknown commerce section", () => {
    const urls = buildGithubMarkdownUrls(
      "https://developer.adobe.com/commerce/non-existent-section/foo",
    );
    assert.deepEqual(urls, []);
  });
});
