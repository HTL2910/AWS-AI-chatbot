import * as path from "path";

export type LinkCandidate = {
  url: string;
  label: string;
};

export function extractUrls(text: string) {
  const urls: string[] = [];
  const seen = new Set<string>();
  const re = /https?:\/\/[^\s<>"'`)\]]+/gi;
  for (const match of String(text || "").matchAll(re)) {
    const cleaned = match[0].replace(/[.,;:!?]+$/g, "");
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      urls.push(cleaned);
    }
  }
  return urls;
}

export function sameDocsSection(seed: URL, candidate: URL) {
  if (seed.origin !== candidate.origin) return false;
  const seedParts = seed.pathname.split("/").filter(Boolean);
  const candidateParts = candidate.pathname.split("/").filter(Boolean);
  const docsIndex = seedParts.indexOf("docs");
  if (docsIndex < 0) return candidate.pathname.startsWith(path.posix.dirname(seed.pathname));
  const prefix = seedParts.slice(0, Math.min(seedParts.length, docsIndex + 2)).join("/");
  return candidateParts.join("/").startsWith(prefix);
}

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function htmlToReadableText(html: string) {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ");
  return decodeHtmlEntities(
    withoutScripts
      .replace(/<\/(h1|h2|h3|h4|p|li|tr|pre|code|section|article|main)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export function extractPageTitle(html: string) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = h1 || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  return htmlToReadableText(title).replace(/\s+/g, " ").trim();
}

export function extractRelatedLinks(html: string, seedUrl: string) {
  const seed = new URL(seedUrl);
  const links: LinkCandidate[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(re)) {
    try {
      const url = new URL(match[1], seed);
      url.hash = "";
      if (!/^https?:$/.test(url.protocol)) continue;
      if (!sameDocsSection(seed, url)) continue;
      const normalized = url.toString().replace(/\/$/, "");
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      links.push({ url: normalized, label: htmlToReadableText(match[2]).replace(/\s+/g, " ").slice(0, 120) });
    } catch {
      // Ignore malformed anchors.
    }
  }
  return links;
}

export function inferredDocsSiblingLinks(seedUrl: string) {
  const seed = new URL(seedUrl);
  const normalizedPath = seed.pathname.replace(/\/$/, "");
  const parts = normalizedPath.split("/").filter(Boolean);
  if (parts.length < 2) return [];

  const currentSlug = parts[parts.length - 1];
  const baseParts = currentSlug === "overview" ? parts.slice(0, -1) : parts;
  const basePath = "/" + baseParts.join("/");
  const candidates = [
    "overview",
    "navigation",
    "modes-and-skills",
    "security-and-governance",
    "best-practices"
  ];

  return candidates.map((slug) => ({
    url: `${seed.origin}${basePath}/${slug}`,
    label: slug.replace(/-/g, " ")
  }));
}

export function uniqueLinks(links: LinkCandidate[]) {
  const out: LinkCandidate[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const normalized = link.url.replace(/\/$/, "");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({ ...link, url: normalized });
  }
  return out;
}
