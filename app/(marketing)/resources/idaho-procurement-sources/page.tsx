import Link from "next/link";
import type { Metadata } from "next";
import { MarketingShell, TrialCTA } from "@/components/marketing/site-shell";
import { publicMetadata } from "@/lib/marketing/metadata";
import {
  PROCUREMENT_SOURCES,
  REGISTER_PUBLISHED_ON,
  lastVerifiedOn,
  procurementLevels,
} from "@/lib/marketing/procurement-sources";
import {
  breadcrumbSchema,
  jsonLdGraph,
  jsonLdString,
  organizationRef,
  organizationSchema,
  siteUrl,
} from "@/lib/marketing/schema";

const PATH = "/resources/idaho-procurement-sources";
const TITLE = "Idaho public procurement sources, by buying authority";
const DESCRIPTION =
  "Which Idaho authority advertises which public work, on which official bid source, and what each source leaves out. Free to cite, with the register available as JSON and CSV.";

export const metadata: Metadata = publicMetadata(TITLE, DESCRIPTION, PATH);

/**
 * The register as a page.
 *
 * Built to be cited rather than to convert. A guide gets read once; a register
 * that answers "have I checked everywhere" gets linked to by the people who
 * would otherwise have to maintain their own copy -- an accelerator, an SBDC
 * counsellor, a city economic development office, a library business guide. So
 * the things that make citing it easy are treated as features and not
 * afterthoughts: a stable id per entry, a visible last-checked date, a
 * copy-ready citation, and the same data as JSON and CSV for anyone who wants
 * to reuse it rather than retype it.
 *
 * The product pitch is one line at the bottom. A register that argues for the
 * software in the middle of its own table is an advertisement, and nobody links
 * to an advertisement.
 */
export default function IdahoProcurementSourcesPage() {
  const site = siteUrl();
  const url = `${site}${PATH}`;
  const verified = lastVerifiedOn();

  /**
   * Dataset alongside the usual Article and Breadcrumb.
   *
   * The register is a dataset with distributions, and saying so is what lets a
   * search or answer engine treat it as a citable source of record rather than
   * as another blog post that happens to contain links.
   */
  const schema = jsonLdGraph([
    organizationSchema(site),
    {
      "@type": "Dataset",
      "@id": `${url}#dataset`,
      name: TITLE,
      description: DESCRIPTION,
      url,
      identifier: url,
      datePublished: REGISTER_PUBLISHED_ON,
      dateModified: verified,
      inLanguage: "en-US",
      isAccessibleForFree: true,
      // The terms are the page's own "Reuse and citation" section: free to
      // quote, link to and build on, attribution requested.
      license: `${url}#reuse`,
      keywords: [
        "Idaho public procurement",
        "Idaho government bids",
        "Boise government bids",
        "Idaho Division of Purchasing",
        "Idaho Division of Public Works",
        "SAM.gov Idaho",
        "government contracting sources",
      ],
      creator: organizationRef(site),
      publisher: organizationRef(site),
      spatialCoverage: { "@type": "Place", name: "Idaho, United States" },
      variableMeasured: "Buying authority, official bid source URL, scope covered, scope not covered, registration route, date last verified",
      distribution: [
        {
          "@type": "DataDownload",
          encodingFormat: "application/json",
          contentUrl: `${url}/data.json`,
        },
        {
          "@type": "DataDownload",
          encodingFormat: "text/csv",
          contentUrl: `${url}/data.csv`,
        },
      ],
    },
    breadcrumbSchema([
      { name: "Home", path: "/" },
      { name: "Resources", path: "/resources" },
      { name: TITLE, path: PATH },
    ], site),
  ]);

  return (
    <MarketingShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(schema) }}
      />
      <article className="bco-container bco-guide">
        <nav className="bco-breadcrumb" aria-label="Breadcrumb">
          <Link href="/">Home</Link>
          <span aria-hidden="true">/</span>
          <Link href="/resources">Resources</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Reference</span>
        </nav>
        <p className="bco-kicker">Reference</p>
        <h1>{TITLE}</h1>
        <p className="bco-lead">
          Idaho has no single public bid board. Each authority advertises its own
          work on its own source, and registering with one subscribes you to that
          one. This register names who buys what, where it is advertised, and, for
          each source, the work that checking it still leaves you blind to.
        </p>
        <p className="bco-caption">
          Maintained by BrostCo · Every URL below is the authority&apos;s own
          official page · Last checked by hand {verified}
        </p>

        <nav className="bco-guide-toc" aria-label="On this page">
          <h2>On this page</h2>
          <ol>
            {procurementLevels().map((level) => (
              <li key={level}>
                <a href={`#${level.toLowerCase().replace(/\s+/g, "-")}`}>{level}</a>
              </li>
            ))}
            <li>
              <a href="#reuse">Reuse and citation</a>
            </li>
          </ol>
        </nav>

        {procurementLevels().map((level) => (
          <section key={level} id={level.toLowerCase().replace(/\s+/g, "-")}>
            <h2>{level}</h2>
            {PROCUREMENT_SOURCES.filter((source) => source.level === level).map((source) => (
              <div key={source.id} id={source.id} className="bco-guide-note">
                <h3>{source.authority}</h3>
                <p>{source.covers}</p>
                <p>
                  <strong>Checking this source does not cover:</strong>
                </p>
                <ul>
                  {source.excludes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p>
                  <strong>To receive notices or submit:</strong> {source.registration}
                </p>
                <p>
                  <a href={source.href} rel="noopener noreferrer">
                    Official source: {source.authority} ↗
                  </a>
                </p>
              </div>
            ))}
          </section>
        ))}

        <section id="reuse">
          <h2>Reuse and citation</h2>
          <p>
            This register is free to quote, link to and build on, including
            commercially, and no permission or email is needed. Attribution is
            requested so a reader can find the current version, because the value
            of a link register is entirely in whether it is up to date.
          </p>
          <p>Cite it as:</p>
          <blockquote>
            <p>
              BrostCo. &ldquo;{TITLE}.&rdquo; Last checked {verified}. {url}
            </p>
          </blockquote>
          <p>
            The same data is available for reuse without scraping the page:{" "}
            <a href={`${PATH}/data.json`}>JSON</a> and{" "}
            <a href={`${PATH}/data.csv`}>CSV</a>. Each entry carries a stable{" "}
            <code>id</code>, so a citation can point at one authority rather than
            the whole page.
          </p>
          <p>
            If an authority is missing, a URL has moved, or a scope description is
            wrong, tell us at{" "}
            <a href="mailto:hello@brostco.com">hello@brostco.com</a> and it will be
            corrected. A correction is not conditional on using the software.
          </p>
          <p className="bco-note">
            This register points to official sources and is not legal or
            procurement advice. Each authority&apos;s own page is the system of
            record for its opportunities, requirements and deadlines. Scope
            descriptions here summarise what a source advertises and can go out of
            date between checks; verify against the authority before relying on
            one.
          </p>
        </section>

        <section>
          <h2>Related guides</h2>
          <ul>
            <li>
              <Link href="/resources/idaho-government-contracts">
                How to find Idaho government contracts
              </Link>
            </li>
            <li>
              <Link href="/resources/boise-government-bids">
                Where to find Boise government bids and RFPs
              </Link>
            </li>
            <li>
              <Link href="/resources/sam-gov-opportunity-search">
                Searching SAM.gov for opportunities
              </Link>
            </li>
          </ul>
        </section>

        <section>
          <h2>Watching several sources at once</h2>
          <p>
            The register describes the problem; keeping up with six sources is the
            work. BrostCo monitors SAM.gov and supported portals, scores what
            matches your company profile, and prepares the bid work for your team
            to review and submit. A manually imported local notice is a saved
            input, not a promise that the local portal is being watched for
            changes.
          </p>
          <Link className="bco-text-link" href="/platform">
            See how BrostCo organizes a pursuit ↗
          </Link>
        </section>
      </article>
      <TrialCTA title="Stop finding out about a bid after it closed." />
    </MarketingShell>
  );
}
