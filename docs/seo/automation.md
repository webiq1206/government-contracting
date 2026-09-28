# The automated backlink programme

**Goal:** high-authority dofollow backlinks accruing with no human input.

This document is blunt about which parts of that are genuinely automated, which
are automated but indirect, and which cannot be automated at all from here. A
backlink report that overstates its own coverage is worse than no report.

---

## Runs on its own, forever

### `.github/workflows/backlink-verify.yml` — daily, 07:12 UTC

Runs on a GitHub Actions runner specifically because a runner has ordinary
internet access and the authoring environment does not. Outbound HTTPS there is
restricted to an allowlist, so nothing in a session can read a third-party page
to check a link attribute. Moving the checks into CI is what makes them possible
at all, not merely convenient.

Each run:

1. **Egress preflight.** Probes every host the automation needs and prints the
   status. First, deliberately: if a runner were also restricted, every later
   step would report "nothing found", and that reads as a fact about the world
   rather than about the network.
2. **`check-site-health.mjs`** — are *our own* critical pages serving? This was
   added after the automation reported healthy straight through an outage in
   which all nine of them answered 500, because nothing was looking here: every
   other check reads somebody else's server. For a backlink programme this is the
   most expensive failure available. A 5xx on `/robots.txt` is read by Google as
   **do not crawl** rather than "no rules", a 5xx on `/sitemap.xml` removes the
   only URL list a crawler was given, a citable page that errors while somebody
   is deciding whether to cite it does not get cited, and earned links pointing
   at error pages get removed. It fails the run and raises the issue.
3. **`check-source-links.mjs`** — every official source the register points at
   still resolves. A moved state purchasing URL is caught before a reader hits a
   404. Distinguishes `moved` (works now, will not forever), `blocked` (a refusal,
   not a finding) and `broken` (genuinely dead); only `broken` fails.
4. **`discover-citations.mjs`** — asks the free keyless indexes who is citing us
   and appends anything new to the ledger as `discovered`.
5. **`verify-backlinks.mjs`** — reads the live link attribute of every recorded
   placement, including whatever discovery just added. This is the step that
   catches a dofollow link quietly becoming nofollow.
6. **Commits the evidence back** — on the default branch only. On a feature
   branch the bot's commit would become that branch's pull-request head, carry a
   skip-CI marker, and leave the head with no check results at all; every other
   branch keeps its evidence in the uploaded artifact instead.
7. **Opens one issue, only if** our own site is failing or a placement recorded
   as `published` stopped verifying. Reuses a single issue rather than opening one
   a day, because a label that fires every morning is a label everyone learns to
   ignore.

The schedule begins when this file reaches the default branch — GitHub only runs
`schedule` from there.

### `.github/workflows/indexnow.yml` — on content change

Pushes changed URLs to Bing, Yandex, Seznam and Naver, which share one IndexNow
network. Triggered by content changing rather than by a clock, which is both the
point of the protocol and its etiquette: re-submitting unchanged pages on a timer
is the one thing its operators ask sites not to do.

This matters to backlinks because of an ordering problem that is easy to miss: a
page written to be cited cannot be cited while nobody can find it, and ordinary
crawling can leave a new reference page unindexed for weeks. IndexNow closes that
to minutes.

Permanently unattended: ownership is proved by the key file the app serves at
`/indexnow-key.txt`, so there is no account, no token, nothing to renew. Google
does not participate and reads the sitemap instead.

---

## Automated, but indirect

The mechanism that actually earns high-authority dofollow links is not
submission, it is being worth citing. `/resources/idaho-procurement-sources` is
built for that: openly reusable, machine-readable at `/data.json` and
`/data.csv`, `schema.org/Dataset` markup, a copy-ready citation, a stable `id`
per entry, and a visible hand-checked date.

The automation keeps that asset trustworthy — which is the part that decays. A
link register is cited for exactly as long as its links work, and the daily
source-link check is what keeps that true without anyone remembering to look.

The `Dataset` markup also makes the register eligible for Google Dataset Search,
which discovers by crawling and needs no submission. That is live now.

---

## Cannot be automated from here, and why

**Submitting to any platform that requires an account.** Software directories,
publishing platforms and dataset catalogues all require a registered, email-
verified account. That needs a mailbox on the site's own domain, and most
platforms put a CAPTCHA in front of registration specifically to stop automated
signup. Automating past that would mean defeating an anti-bot control and, on
most of those platforms, breaking the terms of service. So the prepared
submissions in `docs/seo/submissions/` stay prepared: complete, ready to paste,
and waiting on credentials rather than on authoring.

**Enumerating inbound links.** Listing every backlink to a domain requires a
commercial index — Ahrefs, Majestic, Moz, Semrush. This account's Ahrefs plan
returns `Insufficient plan` for API access (verified twice, across a
reconnection). `discover-citations.mjs` therefore covers what is free and
keyless: Wikimedia `exturlusage`, OpenAlex, Crossref, and Common Crawl presence.
Those find scholarly and wiki citations and confirm crawl presence. They will not
find a directory listing or a blog mention, and the evidence file says so in its
`coverage` field so a thin result is never misread as "nobody links to us".

---

## To widen what runs unattended

In rough order of how much each unlocks:

1. **A mailbox on `brostco.com`.** The single biggest unlock. It turns every
   prepared submission in `docs/seo/submissions/` from blocked into doable, and
   it is the prerequisite for every account-based placement.
2. **An Ahrefs plan with API access.** Would let the daily job enumerate real
   inbound links and verify their attributes at scale, rather than inferring
   from free indexes. Note this needs no change to network policy: the connector
   is reached through Anthropic's servers, not the environment's egress proxy.
3. **Widened egress on the environment**, or the destination hosts allowlisted.
   Only needed for authoring-session work; the scheduled CI jobs do not depend
   on it.

## Extending the daily job

Add a script under `scripts/seo/`, then a step in `backlink-verify.yml`. Two
conventions worth keeping, because both were learned the hard way here:

- **A refusal is not a finding.** `403` with no HTML body, and `200` carrying a
  bot interstitial, both mean we never saw the page. Report them as `blocked` and
  keep them out of the results. `verify-backlinks.mjs` has the detection.
- **Fail the run only on something a person must act on.** A source being
  unreachable is weather. A recorded dofollow link turning into a nofollow is
  work.
- **A relevance search is not a substring search**, and this one cost a
  correction. The first live discovery run asked Crossref for `brostco.com` and
  got fifty confident results, led by Las Vegas Sands litigation and a Brazilian
  theatre anthology — then wrote all fifty into the ledger as citations. Crossref
  did nothing wrong; a fuzzy query was answered fuzzily. Any API that ranks by
  relevance needs its results filtered on the domain actually appearing in the
  record, and any step that writes to the ledger needs a cap that refuses a
  suspiciously large batch rather than trusting it. Both are now in
  `discover-citations.mjs`.
- **Fail closed when writing.** A missed real citation is found again tomorrow.
  A batch of fictional ones has to be noticed and unpicked by hand.
