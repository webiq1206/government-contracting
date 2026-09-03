import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { getFoundingPromo } from "@/lib/billing/promo";
import { ANNUAL_MONTHS_CHARGED, PLANS, TRIAL_DAYS, planPrice } from "@/lib/billing/catalog";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.APP_URL || "https://brostco.com";

export const metadata: Metadata = {
  title: "Brost Co Pricing Explained | What It Costs and What You Also Pay",
  description:
    "What Brost Co costs per month and per year, what the free trial includes, which API keys you supply yourself, and how to work out whether it pays for itself on your bid volume.",
  alternates: { canonical: "/pricing-guide" },
  openGraph: {
    title: "Brost Co Pricing Explained",
    description:
      "The monthly and annual price, what the trial covers, the costs that are not on the invoice, and how to tell whether it pays for itself.",
    url: `${SITE_URL}/pricing-guide`,
    type: "article",
    siteName: "Brost Co",
  },
  twitter: {
    card: "summary",
    title: "Brost Co Pricing Explained",
    description:
      "The monthly and annual price, what the trial covers, and the costs that are not on the invoice.",
  },
};

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/**
 * The pricing page a buyer actually wants, rather than a price tag.
 *
 * Every figure comes from lib/billing/catalog.ts, which is the one place a
 * dollar amount is allowed to be defined in this application. A price written
 * out here would be a second source of truth for the number a customer is
 * charged, and the first thing to go stale after a price change.
 *
 * The section that earns this page its place is "What is not on the invoice".
 * After the trial the customer supplies their own Anthropic and Google Maps
 * keys, so the subscription is not the whole cost, and a buyer who discovers
 * that in week two has been misled by omission. Saying it before they pay is
 * both the honest thing and the thing that makes the page worth citing.
 */
export default async function PricingGuidePage() {
  const promo = await getFoundingPromo({ startIfMissing: false });

  const standardMonthly = planPrice("standard", "month");
  const standardAnnual = planPrice("standard", "year");
  const foundingMonthly = planPrice("founding", "month");
  const foundingAnnual = planPrice("founding", "year");

  const monthsFree = 12 - ANNUAL_MONTHS_CHARGED;

  const answer = promo.active
    ? `Brost Co is ${usd(standardMonthly.amountUsd)} a month. While the founding window is open it is ${usd(
        foundingMonthly.amountUsd
      )} a month, and that rate is locked for as long as the subscription stays active. Paying annually charges ${ANNUAL_MONTHS_CHARGED} months instead of 12, so ${monthsFree} months are free: ${usd(
        standardAnnual.amountUsd
      )} a year at the standard rate. Every plan starts with a free ${TRIAL_DAYS}-day trial that needs no credit card, and nothing is charged unless you choose a plan before it ends.`
    : `Brost Co is ${usd(standardMonthly.amountUsd)} a month. Paying annually charges ${ANNUAL_MONTHS_CHARGED} months instead of 12, so ${monthsFree} months are free: ${usd(
        standardAnnual.amountUsd
      )} a year. Every plan starts with a free ${TRIAL_DAYS}-day trial that needs no credit card, and nothing is charged unless you choose a plan before it ends.`;

  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "How much does Brost Co cost?",
        acceptedAnswer: { "@type": "Answer", text: answer },
      },
      {
        "@type": "Question",
        name: "Is there a free trial, and does it need a credit card?",
        acceptedAnswer: {
          "@type": "Answer",
          text: `Every plan starts with a free ${TRIAL_DAYS}-day trial and it does not need a credit card. Nothing is charged unless you choose a plan before the trial ends. During the trial the Anthropic and Google Maps keys are borrowed from the platform, so you can run the whole workflow before supplying your own.`,
        },
      },
      {
        "@type": "Question",
        name: "What costs are not included in the subscription?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "After the trial you supply your own Anthropic (Claude) API key, which powers scoring and the plain-English bid briefs, and your own Google Maps key, which finds and ranks local subcontractors. Both are billed by those providers on usage, not by Brost Co. A SAM.gov API key is free from SAM.gov. Email sends through your own mailbox, so there is no separate sending cost.",
        },
      },
      {
        "@type": "Question",
        name: "How do I work out whether it pays for itself?",
        acceptedAnswer: {
          "@type": "Answer",
          text: `Compare it against the hours it removes, not against another subscription. The work it takes over is watching SAM.gov, reading solicitations, sourcing subcontractors, chasing quotes and assembling packages. Price those hours at what the person doing them costs you, multiply by the bids you run in a month, and compare with ${usd(
            standardMonthly.amountUsd
          )}. If you are bidding rarely, the honest answer may be that it does not.`,
        },
      },
      // Only while the window is open. Explaining a rate nobody can get is a
      // question a reader did not ask about a price they cannot pay.
      ...(promo.active
        ? [
            {
              "@type": "Question",
              name: "Does the founding rate go up later?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "No. The founding rate is locked for the life of an active subscription and a renewal never moves it to the standard rate. It applies only while the founding window is open, and only to subscriptions started during it.",
              },
            },
          ]
        : []),
      {
        "@type": "Question",
        name: "What happens if I cancel?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The subscription stops at the end of the paid period. Your records stay yours: opportunities, subcontractors, communications and documents are exportable while the account is active.",
        },
      },
    ],
  };

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Pricing guide", item: `${SITE_URL}/pricing-guide` },
    ],
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />

      <MarketingNav loginHref="/login" signupHref="/signup" />

      <main className="mx-auto max-w-3xl px-5 py-16">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            Home
          </Link>
          <span aria-hidden> / </span>
          <span aria-current="page">Pricing guide</span>
        </nav>

        <p className="eyebrow mt-6">Pricing</p>
        <h1 className="mt-2 font-display text-4xl text-foreground">
          What Brost Co costs, and what else you pay
        </h1>

        <p className="mt-5 text-base leading-relaxed text-slate-700">{answer}</p>

        <section className="mt-10">
          <h2 className="font-display text-2xl text-foreground">What are the plans?</h2>
          <div className="scroll-thin mt-4 overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <caption className="sr-only">Brost Co plans, monthly and annual</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="py-2 pr-4 font-semibold">Plan</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Monthly</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Annual</th>
                  <th scope="col" className="py-2 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/60">
                  <th scope="row" className="py-3 pr-4 text-left font-medium">
                    {PLANS.standard.name}
                  </th>
                  <td className="num py-3 pr-4">{usd(standardMonthly.amountUsd)}</td>
                  <td className="num py-3 pr-4">
                    {usd(standardAnnual.amountUsd)}
                    <span className="block text-xs text-muted-foreground">
                      {usd(standardAnnual.perMonthUsd)}/mo effective
                    </span>
                  </td>
                  <td className="py-3 text-slate-600">{PLANS.standard.blurb}</td>
                </tr>
                {promo.active && (
                  <tr className="border-b border-border/60">
                    <th scope="row" className="py-3 pr-4 text-left font-medium">
                      {PLANS.founding.name}
                    </th>
                    <td className="num py-3 pr-4">{usd(foundingMonthly.amountUsd)}</td>
                    <td className="num py-3 pr-4">
                      {usd(foundingAnnual.amountUsd)}
                      <span className="block text-xs text-muted-foreground">
                        {usd(foundingAnnual.perMonthUsd)}/mo effective
                      </span>
                    </td>
                    <td className="py-3 text-slate-600">{PLANS.founding.blurb}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Annual charges {ANNUAL_MONTHS_CHARGED} months rather than 12, so {monthsFree}{" "}
            months are free. Both plans include the whole platform; there is no feature
            tier, no per-seat charge, and no per-opportunity charge.
          </p>
        </section>

        {/*
          * The section this page exists for.
          *
          * A buyer who finds out in week two that the subscription was not the
          * whole cost has been misled by omission, and will say so. Naming it
          * before they pay costs one paragraph and buys the only thing a
          * pricing page can actually earn.
          */}
        <section className="mt-10">
          <h2 className="font-display text-2xl text-foreground">
            What is not on the invoice?
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Two of the services Brost Co runs on are billed to you by their providers
            rather than by us. During the {TRIAL_DAYS}-day trial both are borrowed from
            the platform, so you can run the whole workflow before supplying anything.
          </p>
          <ul className="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
            <li>
              <strong className="text-foreground">An Anthropic (Claude) API key.</strong>{" "}
              Powers opportunity scoring, the plain-English bid brief and call scripts.
              Billed by Anthropic on usage, which scales with how many solicitations you
              put through it.
            </li>
            <li>
              <strong className="text-foreground">A Google Maps API key.</strong> Finds and
              ranks local subcontractors for each trade a project needs. Billed by Google
              on usage.
            </li>
            <li>
              <strong className="text-foreground">A SAM.gov API key.</strong> Free from
              SAM.gov. Required, because nothing can be found without it.
            </li>
            <li>
              <strong className="text-foreground">Your own mailbox.</strong> Outreach sends
              from your address through your connected mail account, so there is no
              separate sending cost and replies land where you already read them.
            </li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-2xl text-foreground">
            How do you tell whether it pays for itself?
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Compare it against the hours it removes, not against another subscription.
            The work it takes over is watching SAM.gov, reading solicitations, sourcing
            subcontractors, chasing quotes and assembling packages. Price those hours at
            what the person doing them costs you, multiply by the bids you run in a
            month, and compare with {usd(standardMonthly.amountUsd)}.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            If you bid rarely, the honest answer may be that it does not. The software
            earns its place on volume and on deadlines that would otherwise be missed,
            not on any single bid.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-2xl text-foreground">
            Common questions about the price
          </h2>
          <dl className="mt-4 space-y-5">
            {faq.mainEntity.slice(1).map((q) => (
              <div key={q.name}>
                <dt className="font-medium text-foreground">{q.name}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-slate-600">
                  {q.acceptedAnswer.text}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-10 border-t border-border pt-6">
          <p className="text-sm leading-relaxed text-slate-600">
            Weighing it against doing this another way? The{" "}
            <Link
              href="/compare"
              className="underline decoration-gold/60 underline-offset-4 hover:text-gold-text"
            >
              comparison of the four usual approaches
            </Link>{" "}
            sets out what each one actually costs in time. Or{" "}
            <Link
              href="/signup"
              className="underline decoration-gold/60 underline-offset-4 hover:text-gold-text"
            >
              start the free trial
            </Link>{" "}
            and put a real solicitation through it.
          </p>
        </section>
      </main>

      <MarketingFooter loginHref="/login" />
    </div>
  );
}
