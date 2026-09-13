# BrostCo public website redesign

Implemented September 13, 2026 from the approved GovDash/BrostCo comparison.

## Changes

- Shared public design system: light canvas, ink typography, teal accents, quieter borders and shadows, responsive layouts, visible focus treatment, and reduced-motion support. The signed-in workspace keeps its existing theme.
- Concrete audience and outcome in the hero. A readable interactive illustration replaces the dimmed autoplay background video.
- Five connected sample stages: discovery, requirements, subcontractor coordination, bid preparation, and Today. Source disclosure and sample review/reset controls never call a live AI service or mutate account records.
- Dedicated platform, AI, subcontractor, product tour, setup, security/data, and company pages.
- Actual workspace recordings remain available on demand with captions, transcripts, and media recovery. Examples and older recorded layouts are disclosed.
- Pricing distinguishes subscription fees from platform usage at confirmed cost plus 25%, or eligible customer-owned service connections. Monthly and annual amounts come from the billing catalog. Founding eligibility and grandfathered subscriptions remain supported.
- A buyer-entered value calculator includes service costs and the exact annual amount averaged monthly. It displays negative results and makes no performance promise.
- Fair comparison of approaches, concrete setup expectations on signup, consistent no-card trial explanations, and readable legal pages.
- Shared navigation, discoverable supporting pages, corrected homepage anchors, and expanded route/crawl/accessibility inventory. Homepage FAQ schema now matches the displayed FAQ.

## Validation

- Production Next.js build passed.
- TypeScript check passed.
- Full local suite: 441 files passed, 4,509 tests passed; 89 files / 735 database or environment-dependent tests skipped by the existing harness.
- Focused marketing interaction tests cover tab selection and keyboard behavior, sample source disclosure, sample review/reset, calculator math, navigation targets, and visible/schema FAQ agreement.
- Lint passed for changed marketing interaction and shell components.
- Production HTTP smoke checks: all 13 public marketing pages plus sitemap.xml, robots.txt, and llms.txt returned 200. This is server response validation, not browser visual evidence.

## Verification limits and deployment

The cloud browser blocks local preview and shared file URLs. Desktop/mobile visual inspection, native mobile menu behavior, and media playback of this revision have not been verified in that browser. Responsive styles and semantic interaction behavior are implemented; the unit tests do not establish visual quality or WCAG conformance.

The Replit workspace is blocked by its Cloudflare verification page. Its Git checkout cannot currently be confirmed or synced from this session. Do not republish an unverified older Replit checkout. After access is restored, inspect its working tree, preserve local changes, finish the documented history reconciliation if still pending, and fast-forward a clean main to the merged revision. See replit-reconciliation.md. Then build and publish, and inspect desktop and mobile public flows.

No database migration, billing calculation change, customer-data edit, testimonial, award statistic, or certification claim is introduced.
