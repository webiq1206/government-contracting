# Submission: software and SaaS directory listings

**Destination link:** `https://brostco.com`
**Status:** prepared, not submitted
**Account needed:** free account per directory, with a verified mailbox on the brostco.com domain
**Fee:** none for the directories worth starting with

One set of facts and copy, reusable across directories, so a listing does not get
rewritten from scratch each time and the business details stay consistent
everywhere. Inconsistent details across listings are worse than no listings.

## Verify before you invest

Both registries verified so far were nofollow. Assume a directory is nofollow
until its own live markup says otherwise, and check a competitor's existing
listing rather than the directory's marketing claims:

```
node scripts/seo/verify-backlinks.mjs --target <a listed company's domain> --probe <that company's listing page>
```

Three outcomes are worth distinguishing, and the verifier reports all three: a
plain `dofollow`; a `nofollow`/`sponsored`/`ugc` rel; and `wrapped`, where the
anchor points at the directory's own out-link redirector rather than at the
destination. A wrapped link is not a backlink to your site.

A nofollow listing can still be worth creating for referral traffic and for
brand presence in comparison searches. Just record it as what it is, and do not
move it into the ledger's `published` bucket.

## Business facts (keep identical across every listing)

| Field | Value |
| --- | --- |
| Product name | BrostCo |
| Legal entity | BROSTCO HOLDINGS LLC |
| Website | https://brostco.com |
| Contact | hello@brostco.com |
| Category | Government contracting / bid and proposal management / business operations |
| Deployment | Web (cloud) |
| Audience | Small and mid-size government contractors, including federal services contractors |
| Free trial | 7 days, no credit card required, does not auto-convert to a paid subscription |
| Pricing page | https://brostco.com/pricing-guide |
| Security page | https://brostco.com/security |
| Product tour | https://brostco.com/demo |

Do not enter specific prices in a directory field. They change, directories
rarely notify anyone, and a stale price in a third-party listing is a support
problem. Point at the pricing page instead.

## Tagline (under 80 characters)

> AI that finds, scores and prepares government bids. Your team reviews and submits.

## Short description (roughly 150 characters, for card and list views)

> BrostCo watches SAM.gov and supported portals, scores opportunities against your
> company profile, coordinates subcontractors and prepares bid packages.

## Medium description (roughly 300 characters)

> BrostCo is an AI platform for small and mid-size government contractors. It
> monitors SAM.gov and supported portals, scores each opportunity against a
> versioned company profile, reads solicitations, finds and vets subcontractors,
> chases quotes and prepares bid documents. Your team reviews, prices and submits.

## Long description

> BrostCo is an AI platform for small and mid-size government contractors,
> operated by BROSTCO HOLDINGS LLC. It covers the work between finding an
> opportunity and submitting a bid, which is where small teams lose the most
> time.
>
> The platform monitors SAM.gov and supported portals, scores each opportunity
> against a versioned company profile with hard exclusions applied first, and
> routes what matters into a pursuit. From there it analyses the solicitation
> into scope, requirements and risk flags, researches comparable pricing from
> public award data, finds subcontractor candidates by trade and verifies them,
> runs outreach and follow-up, prepares call cards when a subcontractor replies,
> and assembles a bid package with a compliance checklist.
>
> What it deliberately does not do matters as much. BrostCo does not submit bids.
> Your team reviews requirements, pricing and documents against the original
> solicitation, completes signatures and attestations, and submits through the
> agency's required channel. AI output is presented with its reasoning and source
> material so it can be checked rather than trusted. SAM.gov and agency portals
> remain the official sources for registration, opportunities and submission
> requirements, and no contract award is guaranteed.
>
> Every plan starts with a 7-day free trial that needs no credit card and does
> not automatically become a paid subscription. Service usage is billed
> separately from the subscription, and eligible provider API keys can be
> connected so those providers are paid directly.

## Key features (for a bulleted feature field)

- Opportunity monitoring across SAM.gov and supported portals, with Sources
  Sought notices routed to a higher-priority queue
- Scoring against a versioned company profile, with hard exclusions evaluated
  before the score
- Solicitation analysis into scope, requirements, risk flags and a statement of
  work
- Pricing research from public federal award data, inflation-adjusted, with
  margin scenarios
- Subcontractor discovery by trade, with verification of contact details,
  licence status and federal exclusion records
- Tracked outreach with scheduled follow-up, reply detection and call
  preparation
- Bid package assembly as PDF and DOCX with a QA checklist
- Compliance monitoring for registration, certification and insurance expiry
- An activity record showing what the AI did and the source material it used

## Categories and tags

Government / public sector, proposal management, bid management, RFP software,
construction bidding, AI assistant, business process automation, CRM adjacent,
small business.

## What not to do

- Do not submit to directories that exist only to sell links, or to any site
  whose listings are unrelated to software. A page of outbound links with no
  editorial standard is a liability, not an asset.
- Do not pay for a "featured" or "sponsored" placement expecting authority. A
  paid link should carry `rel="sponsored"`, and a directory that sells dofollow
  links is selling a risk.
- Do not create more than one listing per directory.
- Do not copy a competitor's description.
