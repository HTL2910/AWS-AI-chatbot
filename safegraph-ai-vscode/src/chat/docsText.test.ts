import {
  extractPageTitle,
  extractRelatedLinks,
  extractUrls,
  htmlToReadableText,
  inferredDocsSiblingLinks,
  sameDocsSection,
  uniqueLinks
} from "./docsText";

describe("docsText", () => {
  it("extracts unique cleaned URLs", () => {
    expect(extractUrls("Read https://example.com/docs/a, then https://example.com/docs/a.")).toEqual([
      "https://example.com/docs/a"
    ]);
  });

  it("converts simple HTML to readable text", () => {
    expect(htmlToReadableText("<h1>Title</h1><p>A &amp; B</p><script>ignored()</script>")).toBe(
      "Title\nA & B"
    );
  });

  it("extracts a page title from h1 before title", () => {
    expect(extractPageTitle("<title>Browser</title><h1>Docs Home</h1>")).toBe("Docs Home");
  });

  it("keeps related links inside the same docs section", () => {
    const links = extractRelatedLinks(
      '<a href="/docs/product/setup">Setup</a><a href="/blog/post">Blog</a>',
      "https://example.com/docs/product/overview"
    );
    expect(links).toEqual([{ url: "https://example.com/docs/product/setup", label: "Setup" }]);
  });

  it("detects same docs sections and deduplicates links", () => {
    expect(
      sameDocsSection(
        new URL("https://example.com/docs/product/overview"),
        new URL("https://example.com/docs/product/install")
      )
    ).toBe(true);
    expect(uniqueLinks([{ url: "https://e.test/a/", label: "A" }, { url: "https://e.test/a", label: "B" }])).toEqual([
      { url: "https://e.test/a", label: "A" }
    ]);
  });

  it("infers common sibling docs pages", () => {
    expect(inferredDocsSiblingLinks("https://example.com/docs/product/overview")[0]).toEqual({
      url: "https://example.com/docs/product/overview",
      label: "overview"
    });
  });
});
