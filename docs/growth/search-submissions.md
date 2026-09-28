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

Submit https://brostco.com/sitemap.xml in verified Google and Bing properties
only after the live sitemap returns valid XML. Account connection is required
for Bing. Clarity still needs a BrostCo project ID and tracking installation;
the Composio connector exports analytics but cannot create projects.
Keep Clarity collection off private procurement, billing and document pages.

On September 28, 2026, the homepage, sitemap, robots and health endpoint returned
server errors. Replit's connector reported successful deployment, but its browser
security verification blocked runtime-log access. The runtime cause remains
unconfirmed. Do not bypass the schema check before web startup.
