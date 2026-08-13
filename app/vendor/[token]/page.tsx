import type { Metadata } from "next";
import { headers } from "next/headers";
import { decodePortalToken } from "@/lib/domain/sub-portal-link";
import { rejectedTokenAllowed } from "@/lib/vendor-throttle";
import { loadPortalSubject, subComplianceView } from "@/lib/sub-compliance-store";
import { VendorPortal } from "@/components/vendor-portal";
import { ThemeWordmark } from "@/components/theme-wordmark";

export const dynamic = "force-dynamic";

/**
 * The subcontractor's side of compliance.
 *
 * Everything about this page is shaped by who reads it: an estimator or an
 * owner-operator, on a phone, who has been sent a link by a general contractor
 * they may have spoken to once. They have no account and will never make one.
 * So there is no navigation, no jargon, no mention of tables or statuses, and
 * the page says what is needed and why before it asks for anything.
 *
 * Never indexed. The URL contains a token that can sign a tax form.
 */
export const metadata: Metadata = {
  // The root layout appends "| Brost Co" via its title template.
  title: "Send your paperwork",
  robots: { index: false, follow: false, nocache: true },
};

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-16">
      <div className="card space-y-3 text-center">
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        <p className="text-sm text-slate-600">{children}</p>
      </div>
    </main>
  );
}

function Expired() {
  return (
    <Notice title="This link has expired">
      Paperwork links stop working after a couple of weeks so they cannot be passed around. Reply
      to the email you received and we will send you a fresh one straight away.
    </Notice>
  );
}

export default async function VendorPortalPage({
  params,
}: {
  params: { token: string };
}) {
  const pointer = decodePortalToken(params.token);
  if (!pointer) {
    // A bad token costs nothing to reject, so this is not about load: it is
    // about a run of them from one address being a scan rather than a person
    // with a stale email, and about sharing that count with the write routes.
    const ip =
      headers().get("x-forwarded-for")?.split(",")[0]?.trim() ||
      headers().get("x-real-ip") ||
      "unknown";
    if (!rejectedTokenAllowed(ip)) {
      return (
        <Notice title="Too many attempts">
          Give it a few minutes, then open the link straight from the email we sent you. If it
          still will not load, reply to that email and a person will pick it up.
        </Notice>
      );
    }
    return <Expired />;
  }

  const sub = await loadPortalSubject(pointer.s);
  if (!sub) return <Expired />;

  const { docs, assessment, liveStatus } = await subComplianceView(pointer.s);

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-5 py-10">
      <header className="mb-8">
        <ThemeWordmark className="h-7 w-auto" />
        <h1 className="mt-6 text-2xl font-semibold text-slate-900">
          {sub.company_name}, we need two things on file
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Brost Co bids federal work and brings subcontractors onto it. Before we can send you a
          bid package we have to hold a signed W-9 and current certificates of insurance for you.
          That is a rule we are held to as the prime contractor, not paperwork for its own sake.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          This takes about five minutes. Nothing here creates an account, and you will not be
          asked for a password.
        </p>
      </header>

      <VendorPortal
        token={params.token}
        companyName={sub.company_name}
        docs={docs.map((d) => ({
          id: d.id,
          doc_type: d.doc_type,
          status: liveStatus[d.id] ?? d.status,
          expires_at: d.expires_at,
          carrier: d.carrier,
          signed_at: d.signed_at,
          verified_at: d.verified_at,
          rejection_reason: d.rejection_reason,
        }))}
        blockReason={assessment.blockReason}
        cleared={assessment.clearedForAward}
      />

      <footer className="mt-10 border-t border-border pt-5 text-xs leading-relaxed text-slate-500">
        <p>
          Your taxpayer identification number is encrypted the moment it reaches us and is used
          only to issue your 1099 at the end of the year. It is never shown back in full, on this
          page or on ours.
        </p>
        <p className="mt-2">
          Something not right? Reply to the email you received and a person will pick it up.
        </p>
      </footer>
    </main>
  );
}
