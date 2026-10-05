import type { OppSubCommRow } from "@/lib/data";
import { messageState, MESSAGE_STATE_LABEL } from "@/lib/domain/message-state";

function exactTime(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

/** Show the saved record, including unsuccessful attempts, without implying a send. */
export function OpportunityMessageHistory({ messages }: { messages: OppSubCommRow[] }) {
  if (!messages.length) return <p className="mt-2 text-xs text-slate-500">No message or call details were loaded for this subcontractor. Check their conversation for older records.</p>;
  return (
    <details className="mt-3">
      <summary className="min-h-11 cursor-pointer rounded py-3 text-sm font-medium text-accent focus-visible:outline focus-visible:outline-2">
        Messages and calls ({messages.length})
      </summary>
      <ol className="mt-3 space-y-4">
        {messages.map((message) => {
          const state = messageState({ ...message, direction: message.direction ?? "unknown" });
          return (
            <li key={message.id} className="min-w-0 rounded border border-border p-3 text-xs [overflow-wrap:anywhere]">
              <p className="font-semibold text-slate-900">
                {message.channel === "email" ? state === "opened" ? "Open signal recorded" : state === "clicked" ? "Link-click signal recorded" : MESSAGE_STATE_LABEL[state] : message.channel === "call" ? "Call record" : "Note"}
              </p>
              {message.delivery_detail && <p className="mt-1 text-risk">{message.delivery_detail}</p>}
              <dl className="mt-2 grid gap-1">
                <div><dt className="inline text-slate-500">Recorded: </dt><dd className="inline">{exactTime(message.created_at)}</dd></div>
                {message.channel === "email" && <>
                  <div><dt className="inline text-slate-500">From: </dt><dd className="inline">{message.sender_email || "Not recorded"}</dd></div>
                  <div><dt className="inline text-slate-500">To: </dt><dd className="inline">{message.recipient_email || "Not recorded"}</dd></div>
                </>}
              </dl>
              {message.subject && <p className="mt-2 font-medium">{message.subject}</p>}
              <p className="mt-2 whitespace-pre-wrap">{message.body || "Message text was not saved."}</p>
              {message.channel === "email" && <>
                <p className="mt-2 text-slate-600">
                  {message.delivery_state === "delivered" && message.provider
                    ? "Delivery confirmation recorded."
                    : "No delivery confirmation recorded."}
                </p>
                {message.replied_at && <p className="mt-1">Reply recorded: {exactTime(message.replied_at)}</p>}
                {message.follow_up_at && <p className="mt-1">Saved follow-up time: {exactTime(message.follow_up_at)}. This does not confirm that a follow-up was sent.</p>}
                <details className="mt-2">
                  <summary className="min-h-11 cursor-pointer py-3 text-slate-600">Message evidence</summary>
                  <p className="mt-1">Recorded delivery status: {message.delivery_state || "Unknown"}</p>
                  <p>Mail service: {message.provider || "Not recorded"}</p>
                  <p>Mail service message ID: {message.gmail_message_id || "Not recorded"}</p>
                  {message.opened_at && <p>Open signal: {exactTime(message.opened_at)}. Automated mail scanners can create this signal.</p>}
                  {message.clicked_at && <p>Link-click signal: {exactTime(message.clicked_at)}</p>}
                  <p>Record ID: {message.id}</p>
                </details>
              </>}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
