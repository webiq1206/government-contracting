import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

export const metadata: Metadata = {
  title: "Privacy Policy | Brost Co",
  description: "How Brost Co collects, uses, and protects customer information.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav loginHref="/login" signupHref="/signup" />
      <main className="mx-auto max-w-3xl px-5 py-16">
        <p className="eyebrow">Legal</p>
        <h1 className="mt-2 font-display text-4xl text-foreground">Privacy Policy</h1>
        <p className="mt-3 text-sm text-slate-500">Last updated: August 11, 2026</p>
        <div className="prose-marketing mt-8 space-y-5 text-sm leading-relaxed text-slate-700">
          <p>
            Brost Co (&quot;we&quot;, &quot;us&quot;) provides government contracting software
            operated by BROSTCO HOLDINGS LLC. This policy explains what we collect and how we
            use it when you visit brostco.com or use the Brost Co application.
          </p>
          <h2 className="font-display text-2xl text-foreground">Information we collect</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>Account details (name, email, password hash, company name).</li>
            <li>Company profile data you enter (UEI, CAGE, NAICS, addresses, certifications).</li>
            <li>Opportunity, subcontractor, communication, document, and bid records you create or that automation creates for your organization.</li>
            <li>Billing information processed by Stripe (we do not store full card numbers).</li>
            <li>Product usage events (page views, CTA clicks, checkout milestones) to improve the service.</li>
          </ul>
          <h2 className="font-display text-2xl text-foreground">How we use information</h2>
          <p>
            We use your data to provide the Brost Co platform, run automation on your behalf,
            bill your subscription, secure accounts, and improve reliability. We do not sell
            customer data.
          </p>
          <h2 className="font-display text-2xl text-foreground">Organization isolation</h2>
          <p>
            Customer organizations are isolated in the application layer. Users only access
            records belonging to their organization.
          </p>
          <h2 className="font-display text-2xl text-foreground">Processors</h2>
          <p>
            We use subprocessors such as hosting providers, Stripe (payments), email delivery
            (e.g. Resend), and model providers when you enable AI-assisted features. Each is
            bound by contractual data protections appropriate to their role.
          </p>
          <h2 className="font-display text-2xl text-foreground">Retention</h2>
          <p>
            We retain account and operational records while your subscription is active and for
            a reasonable period afterward for legal, security, and accounting purposes. You may
            request deletion of your account by contacting us.
          </p>
          <h2 className="font-display text-2xl text-foreground">Contact</h2>
          <p>
            Privacy questions:{" "}
            <a className="text-accent hover:underline" href="mailto:hello@brostco.com">
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
