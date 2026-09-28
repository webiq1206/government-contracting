# Submission: dataset registries and open-data catalogues

**Destination link:** `https://brostco.com/resources/idaho-procurement-sources`
**Status:** prepared, not submitted
**Account needed:** free account per catalogue
**Fee:** none

## Why this placement is legitimate

The register is a real dataset, not a page positioned as one. It publishes two
distributions, declares `schema.org/Dataset` markup naming them, states reuse
terms, and carries a hand-checked date:

- `https://brostco.com/resources/idaho-procurement-sources/data.json`
- `https://brostco.com/resources/idaho-procurement-sources/data.csv`

A catalogue submission that points at a marketing page with no machine-readable
form is the thing catalogue moderators reject, and rightly. This one has the
distributions, so it can be submitted honestly.

**Already live without any submission:** the `Dataset` markup makes the register
eligible for Google Dataset Search, which discovers datasets by crawling rather
than by submission. That needed no account and is shipped.

## Metadata (the fields catalogues ask for)

| Field | Value |
| --- | --- |
| Title | Idaho public procurement sources, by buying authority |
| Publisher | BrostCo (BROSTCO HOLDINGS LLC) |
| Landing page | https://brostco.com/resources/idaho-procurement-sources |
| Distributions | JSON (`/data.json`), CSV (`/data.csv`) |
| Spatial coverage | Idaho, United States |
| Temporal | Current; each row carries its own `verified_on` date |
| Rows | 7 |
| Update cadence | Re-checked by hand; `verified_on` per row records the last check |
| Terms | Free to quote, link to and build on, including commercially. Attribution requested. |
| Contact | hello@brostco.com |
| Keywords | government contracting, public procurement, Idaho, bid sources, RFP, SAM.gov, small business |

## Description (for the catalogue's description field)

> Idaho has no single public bid board. Public work is advertised by the
> authority that buys it, on that authority's own source, and a vendor
> registered with one authority is not seeing the others. This dataset records,
> for each of seven authorities that buy public work performed in Idaho, the
> authority's own official opportunity source, what is advertised there, what
> registration is required to receive notices or submit, and what checking that
> source does not cover.
>
> The last field is the reason the dataset exists. Lists of bid boards are
> common; what a given board excludes is not published anywhere we could find,
> and it is the field that determines whether a vendor sees an opportunity at
> all. State purchasing does not advertise state facility construction; neither
> advertises City of Boise work; none cover Ada County Highway District roadway
> work, including streets inside Boise; and federal work performed in Idaho
> appears on none of them.
>
> Columns: `id`, `authority`, `level`, `official_source_url`, `covers`,
> `excludes`, `registration`, `verified_on`. Every `official_source_url` belongs
> to the authority itself rather than to an aggregator, because an aggregator's
> coverage is a commercial decision that can change without notice. Each row is
> checked by hand and carries the date of that check; entries whose URL cannot be
> confirmed are not published.
>
> Compiled and maintained by BrostCo, which also sells software for government
> contractors. The dataset is free reference material, and corrections are
> accepted from anyone at hello@brostco.com.

## Candidate catalogues

Verify each one's outbound link attribute before creating an account. A
catalogue that nofollows its landing-page links is still worth a submission for
discovery, but it should not be recorded as a backlink:

```
node scripts/seo/verify-backlinks.mjs --target <host the catalogue already links to> --probe <catalogue dataset page>
```

Start with general-purpose catalogues that accept externally hosted datasets and
link to the landing page, and with any Idaho or Pacific Northwest regional open
data portal that accepts community contributions. Skip any catalogue that
requires transferring copyright or re-hosting the file, since the whole value of
the register is that the canonical copy stays current at one URL.

## What not to do

- Do not submit the same dataset under several titles to inflate placements.
- Do not upload a copy of the CSV where the catalogue will serve it as the
  canonical version. A stale mirror of a link register is actively harmful: it
  sends people to URLs that have since moved.
- Do not describe the dataset as official, endorsed, or complete.
