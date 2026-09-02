"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { OwnerPicker } from "@/components/owner-picker";
import { PassButton } from "@/components/pass-button";
import { PursuitControls, type PursuitImpactView } from "@/components/pursuit-controls";
import { SkipCallControl } from "@/components/skip-call-control";
import { StopOutreach } from "@/components/stop-outreach";
import type { PursuitState } from "@/lib/domain/pursuit-state";
import {
  MOVE_TARGETS,
  splitRowActions,
  type RowAction,
  type RowWidget,
} from "@/lib/domain/row-actions";
import type { Owner } from "@/lib/domain/ownership";

/**
 * The row's controls: one button, and everything else behind a menu.
 *
 * What goes in it is decided in `lib/domain/row-actions`, which knows the
 * record and the role and nothing about React. This file is only how those
 * decisions look and behave: where the menu opens, what a confirmation looks
 * like, and which existing control a rich action hands off to.
 *
 * Two things it deliberately does not do.
 *
 * It never reimplements a decision that already has a control. Passing asks
 * for a reason through the same component the record page uses; skipping a
 * call, stopping outreach and changing an owner all open the real thing. A
 * thinner copy living in a row is how two screens end up disagreeing about
 * what an action means.
 *
 * And it never renders itself inside an anchor. Several of these surfaces make
 * the whole row a link, so the controls sit beside the link rather than in it:
 * a button nested in an <a> navigates as well as acting, and a nested link is
 * not valid markup at all.
 */
export function RowActions({
  actions,
  members = [],
  owner = null,
  viewerId,
  /** Names the record in the menu button's accessible label. */
  recordLabel,
  className = "",
  /** Smaller type and tighter padding, for dense tables. */
  compact = false,
}: {
  actions: RowAction[];
  /** Everybody who could be given the record. Without it, reassign is dropped. */
  members?: Owner[];
  owner?: Owner | null;
  viewerId?: string;
  recordLabel?: string;
  className?: string;
  compact?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [widget, setWidget] = useState<RowWidget | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);

  // Reassign needs the org's people. A surface that did not load them gets no
  // owner action rather than a picker with nobody in it.
  const usable = members.length
    ? actions
    : actions.filter(
        (a) => !(a.run.via === "widget" && a.run.widget.name === "reassign")
      );

  const { primary, secondary } = splitRowActions(usable);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    function onDown(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [menuOpen]);

  if (!primary && secondary.length === 0) return null;

  function openWidget(w: RowWidget) {
    setMenuOpen(false);
    setWidget(w);
  }

  const itemProps = { onWidget: openWidget, onRan: () => setMenuOpen(false), compact };

  return (
    <span
      ref={wrap}
      // Stops a click reaching a card that handles clicks of its own. No
      // preventDefault: the links in here are the action.
      onClick={(e) => e.stopPropagation()}
      className={`relative inline-flex items-center gap-1.5 ${className}`}
    >
      {primary && <PrimaryAction action={primary} onWidget={openWidget} compact={compact} />}

      {secondary.length > 0 && (
        <>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={recordLabel ? `More actions for ${recordLabel}` : "More actions"}
            onClick={() => setMenuOpen((v) => !v)}
            className={`btn-ghost inline-flex items-center justify-center ${
              compact ? "min-h-8 px-2 text-xs" : "min-h-11 px-2.5 text-sm sm:min-h-9"
            }`}
          >
            <span aria-hidden>⋯</span>
          </button>

          {menuOpen && (
            <>
              {/*
                Phone: a sheet from the bottom. A dropdown anchored to a row
                near the fold opens off the screen, and on the last row of a
                long list it opens under the tab bar.
              */}
              <div className="fixed inset-0 z-50 flex items-end bg-black/40 sm:hidden">
                <button
                  type="button"
                  aria-label="Close menu"
                  className="absolute inset-0 h-full w-full cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div
                  role="menu"
                  aria-label={recordLabel ? `Actions for ${recordLabel}` : "Actions"}
                  className="relative max-h-[80vh] w-full overflow-y-auto rounded-t-xl border-t border-border bg-surface p-2 pb-[env(safe-area-inset-bottom)]"
                >
                  {recordLabel && (
                    <p className="px-3 pb-2 pt-1 text-xs text-muted-foreground">{recordLabel}</p>
                  )}
                  {secondary.map((a) => (
                    <MenuItem key={a.key} action={a} {...itemProps} />
                  ))}
                </div>
              </div>

              {/* Desktop: an ordinary dropdown, right-aligned to the row. */}
              <div
                role="menu"
                aria-label={recordLabel ? `Actions for ${recordLabel}` : "Actions"}
                className="absolute right-0 top-full z-40 mt-1 hidden w-64 rounded-md border border-border bg-surface p-1 shadow-lg sm:block"
              >
                {secondary.map((a) => (
                  <MenuItem key={a.key} action={a} {...itemProps} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {widget && (
        <WidgetSheet
          widget={widget}
          members={members}
          owner={owner}
          viewerId={viewerId}
          onClose={() => setWidget(null)}
        />
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The one button on the row
// ---------------------------------------------------------------------------

function PrimaryAction({
  action,
  onWidget,
  compact,
}: {
  action: RowAction;
  onWidget: (w: RowWidget) => void;
  compact: boolean;
}) {
  const size = compact ? "min-h-8 text-xs" : "min-h-11 text-xs sm:min-h-9 sm:text-sm";
  const tone = action.danger ? "btn-danger" : "btn-primary";
  const className = `${tone} ${size}`;

  if (action.run.via === "link") {
    return external(action.run.href) ? (
      <a href={action.run.href} className={className}>
        {action.label}
      </a>
    ) : (
      <Link href={action.run.href} className={className}>
        {action.label}
      </Link>
    );
  }

  if (action.run.via === "widget") {
    return <WidgetTrigger action={action} className={className} onWidget={onWidget} />;
  }

  return (
    <ActionButton
      endpoint={action.run.endpoint}
      body={action.run.body}
      className={className}
      confirm={action.confirm?.title}
      confirmBody={action.confirm?.body}
      confirmLabel={action.confirm?.confirmLabel}
      danger={action.danger}
      toast={action.toast}
    >
      {action.label}
    </ActionButton>
  );
}

// ---------------------------------------------------------------------------
// One line of the menu
// ---------------------------------------------------------------------------

const ITEM =
  "flex w-full flex-col items-start gap-0.5 rounded px-3 py-2.5 text-left hover:bg-muted focus-visible:bg-muted";

function MenuItem({
  action,
  onWidget,
  onRan,
}: {
  action: RowAction;
  onWidget: (w: RowWidget) => void;
  onRan: () => void;
  compact: boolean;
}) {
  const tone = action.danger ? "text-risk" : "text-foreground";
  const label = <span className={`text-sm font-medium ${tone}`}>{action.label}</span>;
  const hint = action.hint ? (
    <span className="text-xs font-normal text-muted-foreground">{action.hint}</span>
  ) : null;

  if (action.run.via === "link") {
    const href = action.run.href;
    const content = (
      <>
        {label}
        {hint}
      </>
    );
    return external(href) ? (
      <a role="menuitem" href={href} className={ITEM} onClick={onRan}>
        {content}
      </a>
    ) : (
      <Link role="menuitem" href={href} className={ITEM} onClick={onRan}>
        {content}
      </Link>
    );
  }

  if (action.run.via === "widget") {
    const widget = action.run.widget;
    // Passing already has a control that asks for a reason and offers the
    // undo. It goes straight in the menu rather than through a sheet, so the
    // reason dialog is one tap away rather than two.
    if (widget.name === "pass") {
      return (
        <PassButton
          opportunityId={widget.opportunityId}
          title={widget.title}
          className={`${ITEM} text-risk`}
          onDone={onRan}
        >
          {label}
          {hint}
        </PassButton>
      );
    }
    return (
      <button
        role="menuitem"
        type="button"
        className={ITEM}
        onClick={() => onWidget(widget)}
      >
        {label}
        {hint}
      </button>
    );
  }

  return (
    <span className="block">
      <ActionButton
        endpoint={action.run.endpoint}
        body={action.run.body}
        className={ITEM}
        confirm={action.confirm?.title}
        confirmBody={action.confirm?.body}
        confirmLabel={action.confirm?.confirmLabel}
        danger={action.danger}
        toast={action.toast}
        onDone={onRan}
      >
        {label}
        {hint}
      </ActionButton>
    </span>
  );
}

function WidgetTrigger({
  action,
  className,
  onWidget,
}: {
  action: RowAction;
  className: string;
  onWidget: (w: RowWidget) => void;
}) {
  if (action.run.via !== "widget") return null;
  const widget = action.run.widget;
  if (widget.name === "pass") {
    return (
      <PassButton
        opportunityId={widget.opportunityId}
        title={widget.title}
        className={className}
      >
        {action.label}
      </PassButton>
    );
  }
  return (
    <button type="button" className={className} onClick={() => onWidget(widget)}>
      {action.label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The richer controls, opened in place
// ---------------------------------------------------------------------------

const SHEET_TITLE: Record<Exclude<RowWidget["name"], "pass">, string> = {
  move_stage: "Move it to a stage",
  reassign: "Who has this",
  skip_call: "Skip this call",
  stop_outreach: "Stop outreach",
  abort_bid: "Abort this bid",
};

/**
 * The record page's abort control, opened from a row.
 *
 * The counts it shows are read fresh when the sheet opens rather than carried
 * on every row: a list of forty would have meant forty of these queries to
 * populate a panel that is usually never opened, and counts computed when the
 * page rendered are the wrong ones to decide against by the time somebody
 * clicks.
 */
function AbortSheetBody({ opportunityId, title }: { opportunityId: string; title: string }) {
  const [state, setState] = useState<{
    pursuit: PursuitState;
    impact: PursuitImpactView;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetch(`/api/opportunities/${opportunityId}/pursuit`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) {
          setError(data.error ?? "That could not be read just now.");
          return;
        }
        setState({ pursuit: data.state, impact: data.impact });
      })
      .catch(() => {
        if (live) setError("That could not be read just now.");
      });
    return () => {
      live = false;
    };
  }, [opportunityId]);

  if (error) return <p className="text-sm text-risk">{error}</p>;
  if (!state) {
    return <p className="text-sm text-muted-foreground">Reading what this would stop for {title}...</p>;
  }

  return (
    <PursuitControls
      opportunityId={opportunityId}
      state={state.pursuit}
      impact={state.impact}
      canControl
    />
  );
}

function WidgetSheet({
  widget,
  members,
  owner,
  viewerId,
  onClose,
}: {
  widget: RowWidget;
  members: Owner[];
  owner: Owner | null;
  viewerId?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (widget.name === "pass") return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={SHEET_TITLE[widget.name]}
        className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-xl border border-border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            {SHEET_TITLE[widget.name]}
          </h2>
          <button type="button" className="btn-ghost text-xs" onClick={onClose}>
            Close
          </button>
        </div>

        {widget.name === "move_stage" && (
          <div className="grid gap-1.5">
            <p className="text-xs text-muted-foreground">
              Use this when the record is behind where the work actually is. Nothing is
              deleted, and the stage can be changed again.
            </p>
            {MOVE_TARGETS.filter((t) => t.stage !== widget.stage).map((t) => (
              <ActionButton
                key={t.stage}
                endpoint={`/api/opportunities/${widget.opportunityId}/action`}
                body={{ action: "move", stage: t.stage }}
                className="btn-ghost min-h-11 w-full justify-start text-sm"
                toast={{ message: `Moved to ${t.label}.` }}
                onDone={onClose}
              >
                {t.label}
              </ActionButton>
            ))}
          </div>
        )}

        {widget.name === "reassign" && (
          <OwnerPicker
            kind={widget.kind}
            recordId={widget.recordId}
            owner={owner}
            members={members}
            viewerId={viewerId}
          />
        )}

        {widget.name === "skip_call" && (
          <SkipCallControl
            callCardId={widget.callCardId}
            companyName={widget.companyName}
            trade={widget.trade}
            className="btn-ghost min-h-11 text-sm"
          />
        )}

        {widget.name === "abort_bid" && (
          <AbortSheetBody opportunityId={widget.opportunityId} title={widget.title} />
        )}

        {widget.name === "stop_outreach" && (
          <StopOutreach
            subcontractorId={widget.subcontractorId}
            companyName={widget.companyName}
            opportunityId={widget.opportunityId}
            trade={widget.trade}
          />
        )}
      </div>
    </div>
  );
}

/** tel: and mailto: hand off to the device, so they are plain anchors. */
function external(href: string): boolean {
  return /^(tel:|mailto:|https?:)/.test(href);
}
