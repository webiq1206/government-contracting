import { CONTRACTOR_GUIDES } from "./resources";
import { FREE_TOOLS } from "./free-tools";
export function xmlText(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }
export function resourceFeed(origin: string) {
  const base = origin.replace(/\/$/, "");
  const entries = [...FREE_TOOLS.map(t => ({ title: t.title, description: t.description, path: `/tools/${t.slug}` })), ...CONTRACTOR_GUIDES.map(g => ({ title: g.title, description: g.description, path: `/resources/${g.slug}` }))];
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>BrostCo contractor resources</title><link>${xmlText(base + "/resources")}</link><description>Free tools and practical government contracting guides from BrostCo.</description><language>en-US</language><atom:link href="${xmlText(base + "/resources/feed.xml")}" rel="self" type="application/rss+xml"/>${entries.map(e => `<item><title>${xmlText(e.title)}</title><link>${xmlText(base + e.path)}</link><guid isPermaLink="true">${xmlText(base + e.path)}</guid><description>${xmlText(e.description)}</description></item>`).join("")}</channel></rss>`;
}
