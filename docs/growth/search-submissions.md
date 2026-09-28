# Search submissions

## IndexNow

The public ownership key is stored in `public/640f9f9b50947150afc17ad11dff1567.txt`.
No paid service, account, dependency, or secret is needed.

After the production deployment is healthy, run `npm run indexnow -- --dry-run`
then `npm run indexnow` for the initial submission. For later publication changes,
run `npm run indexnow -- https://brostco.com/changed-public-page` with each changed
canonical URL. The script validates the live sitemap and ownership key before
sending anything. It refuses redirects, off-site URLs, query parameters, fragments,
and URLs absent from the public sitemap. Do not repeatedly submit unchanged URLs.
A 200 or 202 response means receipt, not guaranteed indexing. If the POST times
out, its result is unknown; do not automatically retry it in a loop.

## Bing and Google

Submit `https://brostco.com/sitemap.xml` under the verified BrostCo property.
Do this only after the URL returns 200 with valid XML. Check the provider's
reported processing status separately from successful API submission.

## Microsoft Clarity

Project creation and installation remain pending account access and a real
BrostCo project ID. The Composio connector exports analytics; it does not create
projects or install tracking. Do not invent a project ID or enable collection
on signed-in procurement, billing, administration, or document pages.

## Deployment blocker observed September 28, 2026

The homepage, sitemap, robots.txt, favicon, and health endpoint all returned
plain HTTP 500. Replit's connector reported a successful deployment, but that
status does not prove the app is serving requests. Runtime logs are needed to
identify the cause. The schema check before web startup must not be bypassed.
