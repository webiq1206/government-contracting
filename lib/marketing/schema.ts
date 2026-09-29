/**
 * Structured data shared by the public pages.
 *
 * One Organization node, identified by a stable `@id`, so that every page that
 * names BrostCo as author, publisher or creator points at the same entity
 * rather than repeating a slightly different description of it. An answer
 * engine or search index that sees the same identifier on the home page, a
 * guide and the procurement register can join them up; three loose
 * `{ "@type": "Organization", "name": "BrostCo" }` objects are three strangers.
 *
 * Nothing here is invented. There is no street address, telephone number,
 * founding date or social profile on the site, so none is claimed in markup.
 * Add a property only when the same fact is visible to a visitor.
 */

/** The site origin, without a trailing slash. */
export function siteUrl(): string {
  return (process.env.APP_URL || "https://brostco.com").replace(/\/+$/, "");
}

export const ORGANIZATION_NAME = "BrostCo";
export const ORGANIZATION_LEGAL_NAME = "BROSTCO HOLDINGS LLC";
export const ORGANIZATION_EMAIL = "hello@brostco.com";
export const ORGANIZATION_ALTERNATE_NAMES = ["Brost Co"] as const;

/** The identifier every reference to the company uses. */
export function organizationId(site = siteUrl()): string {
  return `${site}/#organization`;
}

/** The full Organization node. Emit once per page that needs it. */
export function organizationSchema(site = siteUrl()) {
  return {
    "@type": "Organization",
    "@id": organizationId(site),
    name: ORGANIZATION_NAME,
    alternateName: [...ORGANIZATION_ALTERNATE_NAMES],
    legalName: ORGANIZATION_LEGAL_NAME,
    url: site,
    // The approved wordmark: 696 x 159, charcoal on transparent, so it reads
    // on a white background. The square mark is 109 px wide, under the
    // 112 px minimum for a logo image, which is why it is not used here.
    logo: {
      "@type": "ImageObject",
      url: `${site}/brand/wordmark-dark.png`,
      width: 696,
      height: 159,
    },
    email: ORGANIZATION_EMAIL,
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: ORGANIZATION_EMAIL,
      availableLanguage: "English",
    },
    description:
      "AI software for small and mid-size government contractors: opportunity discovery, solicitation analysis, subcontractor coordination and bid preparation, with the contractor's team keeping final review and submission.",
  };
}

/** A short reference to the company, for author, publisher and creator. */
export function organizationRef(site = siteUrl()) {
  return { "@type": "Organization", "@id": organizationId(site), name: ORGANIZATION_NAME };
}

export interface Crumb {
  name: string;
  /** Absolute path, or "/" for home. */
  path: string;
}

/** BreadcrumbList for a visible trail. The last crumb is the current page. */
export function breadcrumbSchema(crumbs: Crumb[], site = siteUrl()) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.path === "/" ? site : `${site}${crumb.path}`,
    })),
  };
}

/** The social preview image, which doubles as the generic page image. */
export function siteImage(site = siteUrl()) {
  return {
    "@type": "ImageObject",
    url: `${site}/og.png`,
    width: 1200,
    height: 630,
  };
}

/**
 * Serialise for a JSON-LD script tag. `<` is escaped so a value can never
 * close the script element early.
 */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** Wrap one or more nodes in a single graph with a shared @context. */
export function jsonLdGraph(nodes: object[]) {
  return { "@context": "https://schema.org", "@graph": nodes };
}
