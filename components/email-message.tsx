import type { ReactNode } from "react";
import { splitEmailBody } from "@/lib/domain/email-body";

export function EmailMessage({ body, direction, contact, recipient, date, label, latest = false, children }: {
  body: string | null; direction: "inbound" | "outbound"; contact: string;
  recipient?: string | null; date: string; label?: string; latest?: boolean; children?: ReactNode;
}) {
  const { current, quoted } = splitEmailBody(body);
  const inbound = direction === "inbound";
  return (
    <article className={`min-w-0 overflow-hidden rounded-xl border ${inbound ? "border-accent/35 border-l-4 bg-surface" : "border-border bg-muted/30"}`}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-accent">{label ?? (inbound ? "Received email" : "Outgoing email")}{latest && <span className="ml-2 font-normal text-muted-foreground">Latest message</span>}</p>
          <p className="mt-1 break-words text-sm font-semibold text-foreground">{inbound ? contact : "Your team"}</p>
          {!inbound && <p className="mt-0.5 break-all text-xs text-muted-foreground">To: {recipient || contact}</p>}
        </div>
        <time dateTime={date} className="text-xs text-muted-foreground">{new Date(date).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</time>
      </header>
      <div className="space-y-3 px-4 py-4 text-sm leading-6 text-foreground [overflow-wrap:anywhere]">
        <p className="whitespace-pre-wrap">{current || "No message body was stored."}</p>
        {quoted && <details className="rounded-lg border border-border bg-muted/30 px-3">
          <summary className="min-h-11 cursor-pointer py-2.5 text-xs font-medium text-muted-foreground">Show quoted history</summary>
          <p className="whitespace-pre-wrap border-t border-border py-3 text-muted-foreground">{quoted}</p>
        </details>}
        {children && <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">{children}</div>}
      </div>
    </article>
  );
}

export function EmailTimeline({ messages }: { messages: ReactNode[] }) {
  return <div className="space-y-4">
    {messages.length > 1 && <details className="rounded-xl border border-border px-4">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Earlier messages ({messages.length - 1})</summary>
      <div className="space-y-4 pb-4">{messages.slice(0, -1)}</div>
    </details>}
    {messages.at(-1)}
  </div>;
}
