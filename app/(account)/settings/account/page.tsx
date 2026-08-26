import Link from "next/link";
import { redirect } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { currentSessionId, currentUser } from "@/lib/auth";
import { accountDetails, accountSessions } from "@/lib/account";
import { sessionSummary, sessionView, sortSessions } from "@/lib/domain/session-device";
import {
  ALL_CAPABILITIES,
  can,
  capabilityLabel,
  roleDescription,
  roleLabel,
  rolesWith,
} from "@/lib/domain/roles";
import { DisplayNameForm, PasswordForm, SessionList } from "@/components/account-forms";
import { shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Your account, as opposed to your company's.
 *
 * Every other settings page is organization-wide: the company profile, the
 * automation rules, the templates, the integrations, the bill. There was
 * nowhere at all for the person. You could not change your own name, could not
 * change your password without declaring you had lost it and being signed out
 * of every device, could not see where you were signed in, and could not find
 * out what your role actually permits until something refused you.
 *
 * Deliberately narrow: it holds what is true and leaves out what would be
 * decoration. There is no time zone control, because nothing in the product
 * reads one yet and a setting that changes nothing is worse than its absence.
 * There is no density control, because density is already remembered per table
 * on the table itself, and a second answer would fight the first.
 */
export default async function AccountSettingsPage() {
  const user = await currentUser().catch(() => null);
  if (!user) redirect("/login");

  const [details, sessions, sessionId] = await Promise.all([
    accountDetails(user.id),
    accountSessions(user.id),
    currentSessionId(),
  ]);

  const now = new Date();
  const views = sortSessions(sessions.map((s) => sessionView(s, sessionId, now)));
  const role = user.orgRole;
  const held = ALL_CAPABILITIES.filter((c) => can(role, c));
  const missing = ALL_CAPABILITIES.filter((c) => !can(role, c));

  return (
    <>
      <PageFrame
        title="Your account"
        explanation="Your details, what your role lets you do, your password, and every device signed in as you."
        breadcrumbs={[{ label: "Settings", href: "/settings/notifications" }]}
        status={roleLabel(role)}
      />
      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5">
        <section aria-labelledby="acct-details" className="max-w-3xl space-y-3">
          <div className="border-b-2 border-accent/80 pb-2">
            <h2
              id="acct-details"
              className="font-display text-xl font-semibold text-foreground"
            >
              Your details
            </h2>
          </div>
          <div className="panel-inset space-y-4 px-4 py-4">
            <DisplayNameForm initial={details?.name ?? ""} />
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="label">Email address</dt>
                <dd className="num mt-0.5 break-all text-foreground">{user.email}</dd>
                <dd className="mt-0.5 leading-relaxed text-muted-foreground">
                  This is how you sign in, and the address subcontractor replies are matched
                  back to, so it is not editable here. Ask an account owner if it has to
                  change.
                </dd>
              </div>
              <div>
                <dt className="label">With this account since</dt>
                <dd className="mt-0.5 text-foreground">
                  {details?.createdAt ? shortDate(details.createdAt) : "Not recorded"}
                </dd>
              </div>
            </dl>
            {details && details.aliases.length > 0 && (
              <div className="text-sm">
                <p className="label">You also sign in as</p>
                <p className="num mt-0.5 break-all text-muted-foreground">
                  {details.aliases.join(", ")}
                </p>
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="acct-role" className="max-w-3xl space-y-3">
          <div className="border-b-2 border-accent/80 pb-2">
            <h2 id="acct-role" className="font-display text-xl font-semibold text-foreground">
              Your role: {roleLabel(role)}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {roleDescription(role)} Only an account owner or an administrator can change
              it.
            </p>
          </div>
          {/*
            * Both halves, on purpose. A list of what you may do answers "what
            * can I do here" and leaves "why was I refused" to be discovered at
            * the moment of refusal, which is the expensive way to learn it.
            */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="panel-inset px-4 py-3">
              <p className="label">You can</p>
              <ul className="mt-1.5 space-y-1 text-sm text-foreground">
                {held.map((c) => (
                  <li key={c} className="flex gap-2">
                    <span aria-hidden className="text-pursue">
                      ✓
                    </span>
                    {/* Sentence case, not title case: `capitalize` renders
                        "Pursue Or Pass Opportunities", which reads as a
                        product feature rather than a thing you may do. */}
                    <span className="first-letter:uppercase">{capabilityLabel(c)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="panel-inset px-4 py-3">
              <p className="label">You cannot</p>
              {missing.length === 0 ? (
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  Nothing. This role holds every permission in the account.
                </p>
              ) : (
                <ul className="mt-1.5 space-y-1.5 text-sm text-muted-foreground">
                  {missing.map((c) => (
                    <li key={c}>
                      <span className="text-foreground first-letter:uppercase">
                        {capabilityLabel(c)}
                      </span>
                      <span className="block text-xs">Ask {rolesWith(c).toLowerCase()}.</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section aria-labelledby="acct-security" className="max-w-3xl space-y-3">
          <div className="border-b-2 border-accent/80 pb-2">
            <h2
              id="acct-security"
              className="font-display text-xl font-semibold text-foreground"
            >
              Password
            </h2>
          </div>
          <div className="panel-inset px-4 py-4">
            <PasswordForm />
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Forgotten it instead?{" "}
            <Link href="/forgot-password" className="font-medium text-accent hover:underline">
              Send yourself a reset link
            </Link>
            . That route signs out every device including this one, because it proves control
            of your mailbox rather than of this session.
          </p>
        </section>

        <section aria-labelledby="acct-sessions" className="max-w-3xl space-y-3">
          <div className="border-b-2 border-accent/80 pb-2">
            <h2
              id="acct-sessions"
              className="font-display text-xl font-semibold text-foreground"
            >
              Where you are signed in
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              A session lasts 30 days from the day it was created. Devices are named from the
              browser they reported; one signed in before this list existed shows as not
              recorded rather than as a guess.
            </p>
          </div>
          <SessionList sessions={views} summary={sessionSummary(views)} />
        </section>

        <section aria-labelledby="acct-display" className="max-w-3xl space-y-3">
          <div className="border-b-2 border-accent/80 pb-2">
            <h2
              id="acct-display"
              className="font-display text-xl font-semibold text-foreground"
            >
              How the product looks
            </h2>
          </div>
          {/*
            * Pointers, not duplicates. Both of these already exist and are
            * already remembered; a second control here would be a second
            * answer, and the two would disagree the first time somebody used
            * the other one.
            */}
          <ul className="space-y-1.5 text-sm">
            <li className="panel-inset px-4 py-3">
              <p className="font-medium text-foreground">Light or dark</p>
              <p className="mt-0.5 leading-relaxed text-muted-foreground">
                Set with the Light and Dark buttons in the sidebar, and remembered in this
                browser. It follows your system setting until you choose one.
              </p>
            </li>
            <li className="panel-inset px-4 py-3">
              <p className="font-medium text-foreground">Table density and columns</p>
              <p className="mt-0.5 leading-relaxed text-muted-foreground">
                Set on each table, above it, and remembered per page in this browser. Kept
                there rather than here because comfortable rows suit the opportunity list and
                compact ones suit the email log, and one switch for both would be wrong on one
                of them.
              </p>
            </li>
            <li className="panel-inset px-4 py-3">
              <p className="font-medium text-foreground">Time zone</p>
              <p className="mt-0.5 leading-relaxed text-muted-foreground">
                Not a setting yet. Dates and times are shown in this device&apos;s time zone,
                and the day boundary on Today is the server&apos;s. Quote deadlines in
                outreach email spell out the zone they are in, so a subcontractor in another
                one is never left guessing.
              </p>
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}
