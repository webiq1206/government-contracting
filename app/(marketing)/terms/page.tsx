import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import {
  FOUNDING_MONTHLY_USD,
  STANDARD_MONTHLY_USD,
} from "@/lib/billing/prices";

export const metadata: Metadata = {
  title: "Terms of Service | Brost Co",
  description: "Terms governing use of the Brost Co government contracting platform.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav loginHref="/login" signupHref="/signup" />
      <main className="mx-auto max-w-3xl px-5 py-16">
        <p className="eyebrow">Legal</p>
        <h1 className="mt-2 font-display text-4xl text-foreground">Terms of Service</h1>
        <p className="mt-3 text-sm text-slate-500">Last updated: August 11, 2026</p>
        <div className="mt-8 space-y-5 text-sm leading-relaxed text-slate-700">
          <p>
            These Terms govern access to Brost Co, a software service operated by BROSTCO
            HOLDINGS LLC (&quot;Brost Co&quot;). By creating an account or subscribing, you agree
            to these Terms.
          </p>
          <h2 className="font-display text-2xl text-foreground">The service</h2>
          <p>
            Brost Co helps subscribers find, evaluate, pursue, and manage government contracting
            opportunities. Brost Co does not guarantee contract awards, does not replace SAM.gov
            or agency portals, and does not submit bids without your review and action.
          </p>
          <h2 className="font-display text-2xl text-foreground">Accounts and organizations</h2>
          <p>
            You are responsible for safeguarding login credentials and for activity under your
            organization. You must provide accurate company registration information when using
            federal bidding features.
          </p>
          <h2 className="font-display text-2xl text-foreground">Fees and founding pricing</h2>
          <p>
            Standard subscription pricing is ${STANDARD_MONTHLY_USD.toLocaleString()} per month
            unless a different rate is agreed in writing. During the limited founding promotion,
            new subscribers may lock in ${FOUNDING_MONTHLY_USD.toLocaleString()} per month for the
            life of that active subscription. If the subscription is canceled and later renewed
            after the promotion ends, standard pricing applies. Prices are billed in advance via
            Stripe. Taxes may apply.
          </p>
          <h2 className="font-display text-2xl text-foreground">Cancellation</h2>
          <p>
            You may cancel at any time from Billing settings. Access continues through the end of
            the paid period unless otherwise stated in Stripe. Founding rates are not transferable
            between organizations.
          </p>
          <h2 className="font-display text-2xl text-foreground">Acceptable use</h2>
          <p>
            You may not misuse the service, attempt to access other customers&apos; data, reverse
            engineer the platform except where permitted by law, or use Brost Co for unlawful
            procurement activity.
          </p>
          <h2 className="font-display text-2xl text-foreground">Disclaimer</h2>
          <p>
            The service is provided &quot;as is.&quot; Brost Co is not a law firm, broker, or
            contracting officer. You remain responsible for compliance with FAR/DFARS, solicitation
            instructions, and representations you submit.
          </p>
          <h2 className="font-display text-2xl text-foreground">Contact</h2>
          <p>
            Questions:{" "}
            <a className="text-accent hover:underline" href="mailto:hello@brostco.com">
              hello@brostco.com
            </a>
            . Privacy details are in our{" "}
            <Link href="/privacy" className="text-accent hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
