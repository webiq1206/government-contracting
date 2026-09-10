"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Shared small-screen navigation on the landing page and public guides. */
export function MarketingMobileMenu({ signupHref, loginHref, onLanding = false, dark = false }: {
  signupHref: string;
  loginHref: string;
  onLanding?: boolean;
  dark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open || !dialog.current) return;
    const panel = dialog.current;
    const opener = trigger.current;
    const overflow = document.body.style.overflow;
    panel.showModal();
    closeButton.current?.focus({ preventScroll: true });
    document.body.style.overflow = "hidden";
    return () => {
      panel.close();
      document.body.style.overflow = overflow;
      opener?.focus({ preventScroll: true });
    };
  }, [open]);
  return <>
    <button ref={trigger} type="button" aria-label="Open navigation" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)} className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-2xl ${dark ? "text-white" : "text-foreground"}`}>
      <span aria-hidden="true">☰</span>
    </button>
    {open && createPortal(<dialog ref={dialog} aria-labelledby={titleId} aria-modal="true"
      onCancel={event => { event.preventDefault(); setOpen(false); }}
      onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-ink/50 p-3 text-foreground backdrop:bg-black/30">
      <div className="ml-auto flex max-h-[calc(100dvh-1.5rem)] w-full max-w-sm flex-col overflow-y-auto rounded-xl border border-border bg-surface p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold">Explore Brost Co</h2>
          <button ref={closeButton} type="button" className="btn-ghost min-h-11" aria-label="Close navigation" onClick={() => setOpen(false)}>Close</button>
        </div>
        <nav aria-label="Mobile navigation" className="grid gap-1" onClick={event => { if ((event.target as Element).closest("a")) setOpen(false); }}>
          {[["platform", "Product"], ["workflow", "How it works"], ["pricing", "Pricing"], ["faq", "FAQ"]].map(([id, label]) =>
            <a key={id} href={`${onLanding ? "" : "/"}#${id}`} className="flex min-h-11 items-center rounded-md px-3 text-base hover:bg-muted">{label}</a>
          )}
          <a href="/compare" className="flex min-h-11 items-center rounded-md px-3 text-base hover:bg-muted">Compare approaches</a>
          <a href={loginHref} className="mt-2 flex min-h-11 items-center rounded-md border-t border-border px-3 text-base">Log in</a>
          <a href={signupHref} className="btn-primary mt-2 min-h-11">Start free trial</a>
        </nav>
      </div>
    </dialog>, document.body)}
  </>;
}
