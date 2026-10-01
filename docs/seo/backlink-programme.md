# Dofollow backlink programme

> October 1 scope correction: this is a historical September 27 record. Its network limitations and blanket dofollow-only prioritization are not current operating rules. Follow docs/growth/PROGRAM.md and placements.json for the expanded program. Relevant nofollow links, redirects and brand mentions can be useful referral placements. A sampled page does not establish sitewide attributes or ranking impact. Keep the existing verifier's narrower published status intact, and record other verified publications in the inclusive placement ledger.

**Date:** 2026-09-27
**Target site:** https://brostco.com

Verified results first, then what is blocked, then what is prepared. The
headline: **no backlink was published**, because publishing one from the working
session was not possible. What was built instead is the asset that makes a
high-authority link earnable, and the tooling that will not let an unverified
claim be recorded as a win.

---

## 1. Published and verified backlinks

**None.** Two independent blockers, both environmental rather than editorial:

**Network egress.** Outbound HTTPS from the working session is restricted to an
allowlist — `brostco.com`, `github.com`, and package registries. Every candidate
platform is refused at the proxy with `HTTP 403` before the request reaches it.
25 of 30 probed platforms record verdict `blocked` in
`dofollow-platform-probe-evidence.json`. This blocks submission *and*
verification: a link attribute can only be established by reading the live page.

**No credentials.** There is no BrostCo-controlled mailbox or platform account
in the session. The connected mailbox belongs to an unrelated business, so no
account can be created, email-verified, or signed into on brostco.com's behalf.

Nothing was published, so nothing is claimed. An entry appears in the ledger's
`published` bucket only when `verify-backlinks.mjs` has read the live page and
confirmed a dofollow link, and the script exits non-zero if a `published` entry
ever stops verifying.

---

## 2. Verified findings

Two platforms were reachable and produced real evidence. Both are negative
results, which is the point: each one saves the effort of a listing that would
have passed no authority.

| Platform | Finding | Evidence |
| --- | --- | --- |
| GitHub | **nofollow**, site-wide | `https://github.com/vercel/next.js` — every external anchor carried `rel="nofollow"`, the repository's own homepage link included, as `rel="noopener noreferrer nofollow"` |
| SourceForge | **nofollow** | `https://sourceforge.net/projects/sevenzip/` — the project's own "Web Site" link carried `rel="nofollow"` |

Both are high-authority domains that pass no authority. This is exactly the
assumption the brief warned against, and it held.

Also verified, on brostco.com itself: all seven official-source links on the new
register render as dofollow (`rel="noopener noreferrer"`, which does not
devalue), the `Dataset` structured data is present, and the page reaches
`sitemap.xml`, `robots.txt` and `llms.txt`.

---

## 3. What was built: the reason a link would be given

A SaaS marketing page is hard to link to, and the authorities worth a link from —
library and university guides, procurement accelerators, SBDCs, economic
development offices — link to free reference material, not to products. Before
this, the site offered nothing citable: no openly reusable resource, no
machine-readable data, no citation path.

**`/resources/idaho-procurement-sources`** — a maintained register of which Idaho
authority advertises which public work, on which official source, and *what each
source leaves out*.

That last field is the original contribution. Lists of bid boards are easy to
find. What a given board excludes is not published anywhere found, and it is the
field that decides whether a contractor sees an opportunity at all — state
purchasing does not advertise state facility construction, neither advertises
City of Boise work, none cover Ada County Highway District roadway work including
the streets inside Boise, and federal work performed in Idaho appears on none of
them.

What makes it citable rather than merely good:

- **Distributions**: `/data.json` and `/data.csv`, open, uncredentialled, CORS-
  enabled. Whoever maintains someone else's resource list can take the rows
  instead of writing a scraper.
- **`schema.org/Dataset`** markup naming both distributions. This also makes the
  register eligible for Google Dataset Search, which discovers by crawling and
  needed no submission — that part is live now.
- **Stated reuse terms**: free to quote, link to and build on, including
  commercially, attribution requested. Ungated, no email capture.
- **A copy-ready citation** and a stable `id` per entry, so a citation can point
  at one authority rather than the whole page.
- **A visible hand-checked date**, per row and in aggregate.
- **Correction route** that is explicitly not conditional on being a customer.

It links out to the Idaho APEX Accelerator's no-cost counselling unprompted and
unreciprocated, which is what makes a submission to that accelerator a
contribution rather than a trade.

---

## 4. Tooling

**`scripts/seo/verify-backlinks.mjs`** — reads the ledger, fetches each live
placement, and reports the link attribute. Built to be hostile to its own ledger:
a `published` entry that does not verify fails the run.

It distinguishes five things a naive check conflates, each of which would
otherwise be written down as a fact about the platform:

- `rel="noopener noreferrer"` is **dofollow**. Treating it as nofollow discards
  good placements.
- A page-level `<meta name="robots" content="nofollow">` or `X-Robots-Tag`
  overrides every anchor on the page. An anchor with no `rel` on such a page is
  still nofollow, and this is the combination a spot-check by eye gets wrong.
- `wrapped` — the anchor points at the directory's out-link redirector, not the
  destination. Not a backlink to your site.
- `blocked` — a `403` with no HTML body, or a `200` carrying a bot-protection
  interstitial ("Client Challenge", "Just a moment"). **Says nothing about the
  platform**, and is kept out of the findings rather than recorded as a missing
  link. This mattered immediately: PyPI answered `200` with a Fastly challenge
  page, which a naive parser reads as "our link is gone".
- `link-absent` — the page was genuinely served and the link is not on it.

```
node scripts/seo/verify-backlinks.mjs                        # check the ledger
node scripts/seo/verify-backlinks.mjs --probe URL --target HOST
node scripts/seo/verify-backlinks.mjs --ledger PATH           # check a candidate list
node scripts/seo/verify-backlinks.mjs --render                # JS-rendered pages
```

`--render` needs a Chromium and, where outbound TLS is re-terminated by a proxy,
that proxy's CA in the browser's own trust store.

**`scripts/seo/check-source-links.mjs`** — re-checks every official-source URL in
the register and the guides. A register of links is trusted exactly as long as
the links work, and a dead link is worse than an absent entry because it sends
somebody to a 404 while looking authoritative. Reports `ok`, `moved`, `blocked`
and `broken`; only `broken` fails the run, because a `403` is a refusal and a
removed page returns `404`. Scoring those the same way would gate a release on a
firewall rule and report seven good government links as dead.

---

## 5. Prepared and ready to submit

Complete content, not a task list. Each file is written to be pasted.

| Target | Prepared content | Needs |
| --- | --- | --- |
| Library and university research guides (LibGuides) | `submissions/library-research-guide.md` | nothing |
| Idaho APEX Accelerator, Idaho SBDC, Idaho Commerce, chambers | `submissions/idaho-assistance-resource-list.md` | nothing |
| Dataset registries and open-data catalogues | `submissions/dataset-registry.md` | free account |
| Software and SaaS directories | `submissions/directory-listing-kit.md` | free account, brostco.com mailbox |

Each one states why the link is legitimate, what to submit, what not to do, and
the verifier command to run *before* investing effort. Dofollow status is marked
`unverified` throughout, because no live page exists to read yet.

---

## 6. To unblock publication

1. **Widen network access** for the session's environment, or allowlist the
   destination hosts. Everything else is in place; this is what prevents both
   submission and verification.
2. **Provide a BrostCo mailbox** (`hello@brostco.com` or similar) so accounts can
   be created and email-verified.

With both, the prepared submissions can be made, and every resulting link put
through the verifier before it is recorded.

## 7. One decision worth taking deliberately

The register states its reuse terms as "free to quote, link to and build on,
including commercially, attribution requested" rather than applying a formal
open licence such as CC BY 4.0. A formal licence is a stronger and more familiar
signal to a catalogue or a librarian, and would likely increase citation — but it
is an irrevocable grant over company content, which is an owner's decision rather
than an implementation detail. Say the word and it becomes a one-line change.

## 8. Noted, not fixed

`components/bid-brief.tsx:98` fails `react/no-unescaped-entities` under
`npm run lint`. Pre-existing on `main` and unrelated to this work, so it was left
alone.
