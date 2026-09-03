import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { planPrice } from "@/lib/billing/catalog";
import { getFoundingPromo } from "@/lib/billing/promo";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.APP_URL || "https://brostco.com";

export const metadata: Metadata = {
  title: "Brost Co vs Spreadsheets, a CRM, Bid Alerts, or Hiring",
  description:
    "The four ways a federal services contractor runs its bid pipeline, what each one actually covers, where each one breaks, and which is the right answer for your bid volume.",
  alternates: { canonical: "/compare" },
  openGraph: {
    title: "Brost Co vs Spreadsheets, a CRM, Bid Alerts, or Hiring",
    description:
      "The four ways a federal services contractor runs its bid pipeline, what each covers, and where each breaks.",
    url: `${SITE_URL}/compare`,
    type: "article",
    siteName: "Brost Co",
  },
  twitter: {
    card: "summary",
    title: "Brost Co vs Spreadsheets, a CRM, Bid Alerts, or Hiring",
    description: "What each of the four usual approaches covers, and where each breaks.",
  },
};

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/**
 * A comparison of approaches, not of named products.
 *
 * The deliberate choice on this page, and the reason it reads the way it does.
 *
 * A page claiming a named competitor charges X and lacks Y is worth writing
 * only if every claim is checked and kept current. Unverified, it is wrong
 * within a quarter, it invites a correction from the company named, and a
 * buyer who catches one error stops believing the rest of the page --
 * including the parts about us. What a buyer is actually choosing between at
 * this stage is four approaches: keep doing it by hand, bend a CRM to it, buy
 * an alert feed, or hire somebody. Those are comparable on evidence we hold.
 *
 * The last column is the one that makes the page honest rather than an advert:
 * each row says who the approach is genuinely the right answer for, including
 * the rows where that is not us. A comparison table with a tick in every one
 * of our boxes is read as marketing and cited by nobody.
 */

interface Approach {
  name: string;
  what: string;
  covers: string;
  breaks: string;
  rightFor: string;
}

const APPROACHES: Approach[] = [
  {
    name: "Spreadsheets and SAM.gov",
    what: "Search SAM.gov by hand, track bids in a sheet, email subcontractors from your inbox.",
    covers:
      "Everything, in the sense that a person is doing it. No software to buy, no data anywhere you cannot reach.",
    breaks:
      "It does not scale past the attention of one person. Solicitations get read late or not at all, follow-ups depend on remembering, and a missed deadline looks identical to a deliberate pass. The failure is silent: nothing tells you what you did not get to.",
    rightFor:
      "A contractor bidding occasionally, on work they already know about, where the pipeline fits in one head.",
  },
  {
    name: "A general CRM",
    what: "Pipedrive, HubSpot, Salesforce or similar, with stages renamed to match bidding.",
    covers:
      "Stages, reminders, contact history and reporting. Genuinely good at making sure nothing is forgotten once it is in the system.",
    breaks:
      "It tracks deals; it does not do the work. Nothing reads a solicitation, scores it against your NAICS codes and set-aside status, finds subcontractors for a trade, or assembles a package. Everything still arrives by hand, and the CRM records that it did.",
    rightFor:
      "A team whose bottleneck is coordination rather than the work itself, or one already standardised on a CRM for the rest of the business.",
  },
  {
    name: "A bid alert or search subscription",
    what: "A feed that watches federal postings and emails you matches.",
    covers:
      "Discovery. You stop missing opportunities that were published.",
    breaks:
      "Discovery was rarely the bottleneck. The work starts after the alert: reading the solicitation, deciding whether it fits, finding the subcontractors, getting prices back before your own deadline. An alert feed hands you more to triage without helping you triage it.",
    rightFor:
      "A contractor who genuinely cannot see the opportunities, and has the capacity to work every one they find.",
  },
  {
    name: "Hiring a capture or proposal person",
    what: "A person whose job is the pipeline.",
    covers:
      "All of it, with judgment. A good capture person does things no software does: reads a customer, decides what to walk away from, calls in a favour.",
    breaks:
      "Cost and single-point risk. It is the most expensive option by a wide margin, and the pipeline leaves when they do. Below a certain bid volume the role is not full-time work, which is how it turns into somebody's second job and gets done at the edges.",
    rightFor:
      "A contractor with the volume to keep the role busy and the margin to fund it. Often the right next step after software, not instead of it.",
  },
];

export default async function ComparePage() {
  /**
   * The price sentence has to agree with the price card a reader just left.
   * The home page links here from directly beneath the founding rate, so
   * quoting the standard rate while the promo is open would read as the price
   * going up between one page and the next. `startIfMissing: false` because a
   * comparison page is not a reason to open a promo window.
   */
  const promo = await getFoundingPromo({ startIfMissing: false });
  const standard = planPrice("standard", "month");
  const founding = planPrice("founding", "month");
  const current = promo.active ? founding : standard;

  const answer =
    "A federal services contractor generally picks one of four: keep doing it by hand in spreadsheets, bend a general CRM to it, subscribe to a bid alert feed, or hire a capture person. Each solves a different part. Spreadsheets and CRMs organise the work without doing any of it; alert feeds solve discovery, which is rarely the bottleneck; hiring solves everything and costs the most. Brost Co does the slow middle -- reading solicitations, scoring fit, sourcing and emailing subcontractors, chasing quotes, assembling packages -- and leaves judgment, calls and submission with you.";

  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What are the alternatives to Brost Co?",
        acceptedAnswer: { "@type": "Answer", text: answer },
      },
      {
        "@type": "Question",
        name: "How is Brost Co different from a CRM?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "A general CRM tracks deals: stages, reminders, contact history. Brost Co runs the federal bid lifecycle itself -- NAICS fit, set-asides, deadlines, subcontractor coverage per trade, quote tracking, compliance checks and submission readiness -- and does the reading, sourcing and chasing rather than recording that somebody else did it.",
        },
      },
      {
        "@type": "Question",
        name: "Is Brost Co a replacement for a bid alert subscription?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "It covers the same discovery: it watches SAM.gov and pulls in matching postings. The difference is what happens next. An alert feed hands you a list to triage; Brost Co scores each posting against your company, says why, and carries the ones you pursue through sourcing, quotes and package assembly.",
        },
      },
      {
        "@type": "Question",
        name: "Should I use Brost Co instead of hiring a capture person?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "They are not substitutes. A capture person brings judgment software does not have: reading a customer, deciding what to walk away from, calling in a favour. Brost Co removes the hours around that judgment. Contractors below the volume that keeps a capture role busy usually get further with the software first; above it, the two work together.",
        },
      },
      {
        "@type": "Question",
        name: "What does Brost Co deliberately not do?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "It does not replace SAM.gov, which remains the official source for opportunities and entity registration. It does not submit bids: signatures, attestations and the submission stay with your team. And it does not send subcontractor email without your own connected mailbox and a completed sender identity.",
        },
      },
    ],
  };

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Compare", item: `${SITE_URL}/compare` },
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
          <span aria-current="page">Compare</span>
        </nav>

        <p className="eyebrow mt-6">Compare</p>
        <h1 className="mt-2 font-display text-4xl text-foreground">
          The four ways to run a federal bid pipeline
        </h1>

        <p className="mt-5 text-base leading-relaxed text-slate-700">{answer}</p>

        <p className="mt-4 text-sm leading-relaxed text-slate-600">
          This compares approaches rather than named products. A page asserting what a
          competitor charges and lacks is only worth reading if every claim is checked and
          kept current, and one stale line is enough to make a reader doubt the rest.
        </p>

        <section className="mt-10">
          <h2 className="font-display text-2xl text-foreground">
            What does each approach actually cover?
          </h2>
          <div className="mt-4 space-y-8">
            {APPROACHES.map((a) => (
              <article key={a.name} className="border-l-2 border-border pl-4">
                <h3 className="font-display text-xl text-foreground">{a.name}</h3>
                <p className="mt-1 text-sm italic leading-relaxed text-slate-500">{a.what}</p>
                <dl className="mt-3 space-y-2 text-sm leading-relaxed">
                  <div>
                    <dt className="font-medium text-foreground">What it covers</dt>
                    <dd className="text-slate-600">{a.covers}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-foreground">Where it breaks</dt>
                    <dd className="text-slate-600">{a.breaks}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-foreground">Right answer for</dt>
                    <dd className="text-slate-600">{a.rightFor}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-2xl text-foreground">Where Brost Co sits</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Brost Co does the slow middle. It watches SAM.gov and scores each posting
            against your company, reads the solicitation for scope and requirements, finds
            subcontractors per trade and emails them a quote request built from the
            solicitation, follows up when nobody answers, tracks the quotes, assembles the
            package and runs compliance checks against it. What arrives on your screen is
            one list of the decisions that need a person.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            It is {usd(current.amountUsd)} a month
            {promo.active
              ? ` while founding enrolment is open, ${usd(standard.amountUsd)} after`
              : ""}
            , which is the comparison that matters against the hours it removes rather
            than against another subscription. The{" "}
            <Link
              href="/pricing-guide"
              className="underline decoration-gold/60 underline-offset-4 hover:text-gold-text"
            >
              pricing guide
            </Link>{" "}
            sets out how to work that out, and the costs that are not on the invoice.
          </p>
        </section>

        {/*
          * The limits, on the comparison page rather than buried.
          *
          * A page that lists what a product does not do is the one a reader
          * believes about what it does. This is also the section an answer
          * engine quotes when somebody asks whether the software submits bids,
          * and being wrong about that in an answer costs a reader a deadline.
          */}
        <section className="mt-10">
          <h2 className="font-display text-2xl text-foreground">
            What Brost Co does not do
          </h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-600">
            <li>
              It does not replace SAM.gov. SAM.gov remains the official source for federal
              opportunities and entity registration.
            </li>
            <li>
              It does not submit bids. Signatures, attestations and the submission itself
              stay with your team.
            </li>
            <li>
              It does not send subcontractor email without your own connected mailbox and a
              completed sender identity.
            </li>
            <li>
              It does not supply judgment. Pursue-or-pass, the calls that email cannot
              replace, and what to walk away from remain yours.
            </li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-2xl text-foreground">Common questions</h2>
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
            The way to settle it is a real solicitation.{" "}
            <Link
              href="/signup"
              className="underline decoration-gold/60 underline-offset-4 hover:text-gold-text"
            >
              Start the free trial
            </Link>{" "}
            and put one through, or read{" "}
            <Link
              href="/pricing-guide"
              className="underline decoration-gold/60 underline-offset-4 hover:text-gold-text"
            >
              what it costs
            </Link>{" "}
            first.
          </p>
        </section>
      </main>

      <MarketingFooter loginHref="/login" />
    </div>
  );
}
