# Submission: library and university business research guides

**Destination link:** `https://brostco.com/resources/idaho-procurement-sources`
**Status:** prepared, not submitted
**Account needed:** none
**Fee:** none

## Why this placement is legitimate

Library and university business guides exist to point patrons at authoritative
free resources, and guides on government contracting routinely list bid sources.
The register is a better fit than a product page in three specific ways, and the
submission should say so rather than assume the librarian will notice:

- It is free, needs no account and no email address, and is not gated.
- It states its reuse terms, so the guide can quote from it.
- It answers the question a guide cannot easily answer itself, which is what a
  given bid source leaves out. Maintaining that boundary information for seven
  authorities is real work, and the register does it for them.

Most of these guides run on Springshare LibGuides under a `.edu` or library
domain. Verify the outbound link attribute on the specific guide before
spending effort, because the platform is not uniform:

```
node scripts/seo/verify-backlinks.mjs --target <a host the guide already links to> --probe <guide URL>
```

## Targeting

Look for guides that already list procurement or bid sources, since those have a
maintainer who has already decided this subject belongs on their site. Search
patterns that surface them:

- `site:libguides.com government contracting bids`
- `site:libguides.com "small business" procurement Idaho`
- Boise State University and University of Idaho library business guides
- Boise Public Library and Ada Community Library business research pages
- Any state library's small-business or grants-and-contracts guide

Prefer a guide whose scope is Idaho or the Pacific Northwest. A national guide
has less reason to list a state register, and a submission that ignores scope is
the kind that gets deleted.

## Submission text (short form, for a "suggest a resource" field)

> **Idaho public procurement sources, by buying authority** —
> https://brostco.com/resources/idaho-procurement-sources
>
> A free register of which Idaho authority advertises which public work, on
> which official source, and what each source does not cover. Idaho has no
> single public bid board, and vendors regularly miss work because registering
> with one authority feels like complete coverage. Each entry links to the
> authority's own page (state purchasing, public works, transportation, City of
> Boise, Ada County Highway District, SAM.gov) and names the work that checking
> it still leaves out. No account, no email gate. Also available as JSON and
> CSV, and free to quote with attribution. Last checked by hand 2026-09-26.

## Submission text (long form, where the form allows a fuller note)

> I would like to suggest a free resource for your government contracting guide.
>
> Idaho has no single public bid board. State purchasing does not advertise
> state facility construction, neither advertises city work, neither covers
> highway district work, and a federal contract performed in Idaho appears on
> none of them. Vendors who register with one authority reasonably conclude they
> are seeing Idaho's public work, and miss bids because of it.
>
> We maintain a free register that addresses this directly:
> https://brostco.com/resources/idaho-procurement-sources
>
> For each of seven authorities it gives the authority's own official source URL,
> what is advertised there, what a vendor has to do to receive notices, and
> — the part we have not found published anywhere else — what checking that
> source still leaves you blind to. Every link goes to the authority itself
> rather than to an aggregator, and each entry carries the date it was last
> checked by hand.
>
> There is no account, no email capture, and no paywall. The register is free to
> quote and link to with attribution, and the same data is published as JSON and
> CSV at `/data.json` and `/data.csv` if it is easier to reuse the rows than
> link to the page.
>
> For disclosure: we publish this alongside a commercial product for government
> contractors. The register itself is free reference material, it links out to
> the Idaho APEX Accelerator's no-cost counselling as an independent resource,
> and we will correct any error whether or not the reporter is a customer.
> Corrections to hello@brostco.com.

## Notes for whoever submits this

Disclose the commercial connection. A librarian who discovers it later removes
the link and remembers the domain; one who is told up front is usually fine with
it, because the resource stands on its own. Do not offer a reciprocal link, do
not ask for a specific anchor text, and do not follow up more than once.
