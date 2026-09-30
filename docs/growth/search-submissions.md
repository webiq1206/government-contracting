# Search submissions

IndexNow uses the existing key in lib/marketing/indexnow.ts, served by
/indexnow-key.txt. The existing IndexNow workflow submits on public content
changes to main. No second ownership key or paid service is needed.

Use `npm run indexnow -- --dry-run` to preview URLs without network requests.
After deployment, use `npm run indexnow` for an initial submission, or
`npm run indexnow -- --url https://brostco.com/changed-public-page` for changed
public URLs. The command checks the homepage, sitemap and live ownership key
before submitting. A 200 or 202 response means receipt, not guaranteed indexing.
An ambiguous timeout should not trigger an automatic retry loop.

## Established setup

The owner's completed setup record confirms Bing ownership and sitemap acceptance, Google sitemap acceptance, Clarity project ypg5p3oq1h with consent and masking, and IndexNow acceptance of 34 URLs (HTTP 202):
https://github.com/webiq1206/government-contracting/actions/runs/36462293271

Do not recreate these integrations or routinely resubmit unchanged URLs. Acceptance is not proof of indexing.

September 30 live checks returned HTTP 200 for the homepage, /tools, /tools/bid-no-bid and /signup. Google Search Console owner access for sc-domain:brostco.com was reconfirmed. Earlier September 28 outage statements are historical.

Traffic and conversion outcomes remain unknown. Keep optional analytics off private procurement, billing and document pages. Preserve the schema check before web startup.
