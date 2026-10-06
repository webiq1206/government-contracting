import { publicMetadata } from "@/lib/marketing/metadata";
import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { AnalyticsPreferencesButton } from "@/components/marketing/clarity-analytics";

export const metadata: Metadata = publicMetadata(
  "Privacy Policy",
  "How BrostCo collects, uses, and protects customer information, which processors are involved, and how long data is kept.",
  "/privacy",
);

export default function PrivacyPage() {
  return (
    <div className="bco-site">
      <a href="#main-content" className="bco-skip">
        Skip to content
      </a>
      <MarketingNav loginHref="/login" signupHref="/signup" />
      <main id="main-content" className="bco-container bco-legal">
        <p className="eyebrow">Legal</p>
        <h1 className="mt-2 font-display text-4xl text-foreground">
          Privacy Policy
        </h1>
        <p className="mt-3 text-sm text-slate-500">
          Last updated: September 29, 2026
        </p>
        <p className="mt-5">
          <Link href="/security">Read the security and data overview</Link> for
          a practical explanation of product controls and AI data flow.
        </p>
        <div id="analytics-preferences" className="mt-4"><AnalyticsPreferencesButton /></div>
        <div className="prose-marketing mt-8 space-y-5 text-sm leading-relaxed text-slate-700">
          <p>
            Brost Co (&quot;we&quot;, &quot;us&quot;) provides government
            contracting software operated by BROSTCO HOLDINGS LLC. This policy
            explains what we collect and how we use it when you visit
            brostco.com or use the Brost Co application.
          </p>
          <h2 className="font-display text-2xl text-foreground">
            Information we collect
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>Account details (name, email, password hash, company name).</li>
            <li>
              Company profile data you enter (UEI, CAGE, NAICS, addresses,
              certifications).
            </li>
            <li>
              Opportunity, subcontractor, communication, document, and bid
              records you create or that automation creates for your
              organization.
            </li>
            <li>
              Billing information processed by Stripe (we do not store full card
              numbers).
            </li>
            <li>
              Product usage events (page views, CTA clicks, checkout milestones)
              to improve the service.
              Anonymous marketing interaction events do not include form values,
              raw URL query strings, referrers, visitor identifiers or tracking cookies.
              Recognized campaign labels are kept in this tab’s session storage and attached to
              interaction and trial-start events to measure which resources help people find BrostCo.
              Free-tool entries are processed only in your browser and are not uploaded.
              Browser interaction tracking honors Do Not Track and Global Privacy Control.
            </li>
          </ul>
          <h2 className="font-display text-2xl text-foreground">
            How we use information
          </h2>
          <p>
            With your permission, Google Analytics measures public website visits,
            campaign performance, website interactions, successful trial signups,
            and verified purchases. It uses analytics cookies and processes device
            and interaction data. Our custom events exclude names, email addresses,
            form entries, private workspace records, and raw URL query strings.
            Purchase events use a hashed transaction reference and the amount
            confirmed by our payment processor. Advertising storage and advertising
            personalization are disabled. Google Analytics is not loaded before
            you select Allow analytics, and tracking honors Do Not Track and Global
            Privacy Control. Use Analytics preferences to withdraw permission.
            See <a className="underline" href="https://policies.google.com/technologies/partner-sites">how Google uses information from sites that use its services</a>.
          </p>
          <p>
            With your permission, we also use Microsoft Clarity for heatmaps and
            masked session recordings to understand navigation and improve usability.
            This optional service processes interaction, device, and page data and
            uses analytics cookies. We mask page text and entered content and do not
            send account identities through Clarity&apos;s identification API.
            Advertising storage is disabled. Clarity is not loaded until you select
            Allow analytics, and is disabled for Do Not Track or Global Privacy Control.
            You can withdraw consent through Analytics preferences at any time.
            See the <a className="underline" href="https://www.microsoft.com/privacy/privacystatement">Microsoft Privacy Statement</a> for
            Microsoft&apos;s data handling practices.
          </p>
          <p>
            We use your data to provide the Brost Co platform, run automation on
            your behalf, bill your subscription, secure accounts, and improve
            reliability. We do not sell customer data.
          </p>
          <h2 className="font-display text-2xl text-foreground">
            Organization isolation
          </h2>
          <p>
            Customer organizations are isolated in the application layer. Users
            only access records belonging to their organization.
          </p>
          <h2 className="font-display text-2xl text-foreground">Processors</h2>
          <p>
            We use subprocessors such as hosting providers, Stripe (payments),
            email delivery (Google), and model providers when you enable
            AI-assisted features. Each is bound by contractual data protections
            appropriate to their role.
          </p>
          <h2 className="font-display text-2xl text-foreground">Retention</h2>
          <p>
            We retain account and operational records while your subscription is
            active and for a reasonable period afterward for legal, security,
            and accounting purposes. You may request deletion of your account by
            contacting us.
          </p>
          <h2 className="font-display text-2xl text-foreground">Contact</h2>
          <p>
            Privacy questions:{" "}
            <a
              className="text-accent hover:underline"
              href="mailto:hello@brostco.com"
            >
              hello@brostco.com
            </a>
            . See also our{" "}
            <Link href="/terms" className="text-accent hover:underline">
              Terms of Service
            </Link>
            .
          </p>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
