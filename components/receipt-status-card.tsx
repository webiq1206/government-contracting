"use client";

import { needsReceiptFollowUp, type SubmissionState } from "@/lib/domain/submission-state";

/**
 * What is proven about this send, and what is still owed.
 *
 * "Sent" is the state that quietly loses bids. The operator uploaded the
 * package, the screen said Submitted, and nobody ever established that the
 * portal actually took it. A rejected upload and a successful one look
 * identical from inside this product, and the difference surfaces when the
 * award goes to somebody else.
 *
 * So the card stays on the screen while the acknowledgement is outstanding,
 * rather than a status word appearing once and the question closing. It says
 * what is on file, not what the state is called: a confirmation number that
 * was never issued reads as "none issued", never as a blank that looks like an
 * oversight, and an unacknowledged send says so in as many words.
 */
export function ReceiptStatusCard({
  state,
  sentAt,
  method,
  destination,
  timezone,
  confirmationNumber,
  proofName,
  onFollowUpHref,
}: {
  state: SubmissionState;
  sentAt: Date | null;
  method: string | null;
  destination: string | null;
  timezone: string | null;
  confirmationNumber: string | null;
  /** The stored receipt, when one is attached. */
  proofName: string | null;
  /** Where to go to add or update the evidence. */
  onFollowUpHref?: string;
}) {
  if (state === "package_ready" || state === "approved") return null;

  const overdue = needsReceiptFollowUp(state, sentAt);
  const acknowledged = state === "receipt_confirmed" || state === "accepted";
  const rejected = state === "rejected" || state === "failed";

  const tone = rejected
    ? "border-risk/40 bg-risk/5"
    : acknowledged
      ? "border-pursue/40 bg-pursue/5"
      : overdue
        ? "border-review/40 bg-review/5"
        : "border-border bg-surface";

  return (
    <div className={`rounded-md border px-4 py-3 ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{headline(state, overdue)}</p>
        {sentAt && (
          <p className="text-xs text-muted-foreground">
            {sentAt.toLocaleString()}
            {timezone ? ` (${timezone})` : ""}
          </p>
        )}
      </div>

      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <Line label="How" value={method} fallback="Not recorded" />
        <Line label="Where" value={destination} fallback="Not recorded" />
        {/* Absent for a good reason, and said as such: plenty of portals issue
            none, and a blank here would read as somebody forgetting. */}
        <Line label="Confirmation number" value={confirmationNumber} fallback="None issued" />
        <Line label="Receipt on file" value={proofName} fallback="Nothing attached" />
      </dl>

      {!acknowledged && !rejected && (
        <p className="mt-2 text-xs text-muted-foreground">
          The agency has not acknowledged this yet. Until it does, what is proven is that
          somebody uploaded a package, not that the buyer received it.
          {onFollowUpHref ? (
            <>
              {" "}
              <a className="underline underline-offset-2" href={onFollowUpHref}>
                Record an acknowledgement
              </a>
              .
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}

function headline(state: SubmissionState, overdue: boolean): string {
  switch (state) {
    case "sending":
      return "Sending";
    case "sent":
      return overdue
        ? "Sent, and still not acknowledged after a day"
        : "Sent, awaiting acknowledgement";
    case "receipt_confirmed":
      return "Receipt confirmed";
    case "accepted":
      return "Accepted by the agency";
    case "rejected":
      return "Rejected by the agency";
    case "withdrawn":
      return "Withdrawn";
    case "failed":
      return "The send failed";
    default:
      return "Nothing has been sent";
  }
}

function Line({
  label,
  value,
  fallback,
}: {
  label: string;
  value: string | null;
  fallback: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-right text-sm ${value ? "text-foreground" : "text-muted-foreground"}`}>
        {value || fallback}
      </dd>
    </div>
  );
}
