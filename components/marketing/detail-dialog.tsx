"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Native modal supplies focus containment and makes the page behind it inert. */
export function DetailDialog({ label, title, children }: {
  label: string;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open || !dialog.current) return;
    const element = dialog.current;
    const opener = trigger.current;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    close.current?.focus({ preventScroll: true });
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      opener?.focus({ preventScroll: true });
    };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="bco-demo-action"
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(true)}>{label}<span aria-hidden="true">↗</span></button>
    {open && createPortal(
      <dialog ref={dialog} id={id} className="bco-site bco-detail-dialog"
        aria-labelledby={`${id}-title`} aria-modal="true"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
          )).filter((element) => element.getClientRects().length > 0);
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first?.focus();
          }
        }}
        onCancel={(event) => { event.preventDefault(); setOpen(false); }}
        onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <div className="bco-detail-header">
          <div><p className="bco-kicker">A closer look</p><h2 id={`${id}-title`}>{title}</h2></div>
          <button ref={close} type="button" className="bco-detail-close" aria-label="Close details" onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="bco-detail-body">{children}</div>
      </dialog>, document.body)}
  </>;
}
