import Link from "next/link";
import {
  ContextSection,
  WorkspacePane,
  WorkspacePlaceholder,
  WorkspaceShell,
} from "@/components/workspace/workspace-shell";
import { QueueRail, type QueueEntry, type QueueTone } from "@/components/workspace/queue-rail";
import { KeyHint, QueueKeys } from "@/components/workspace/workspace-keys";
import { SkipAction } from "@/components/workspace/advance-action";
import {
  ComplianceItemCard,
  type CategoryInfo,
  type ComplianceCardData,
} from "@/components/compliance-item";
import { EmptyState } from "@/components/empty-state";
import type { Owner } from "@/lib/domain/ownership";

/**
 * Renewals, worked one after another instead of hunted for on a board.
 *
 * The board answers "what does the next quarter look like", which is a real
 * question and stays. It is a bad shape for the other real question, which is
 * "there are nine things overdue, get them done": nine editable cards in a
 * two-column grid, each of which has to be expanded, filled in, saved and
 * collapsed, while the grid reflows underneath and the place you had is gone.
 *
 * Here the list holds still on the left, the item is open and editable in the
 * middle, and the right says what this thing actually is and what happens if
 * it lapses -- the paragraph that used to live inside the card and pushed the
 * date field below the fold.
 */

export interface ComplianceWorkEntry {
  id: string;
  label: string;
  area: string;
  dueDisplay: string;
  countdownText: string;
  color: "green" | "amber" | "red" | "slate";
  statusLabel: string;
}

const TONE: Record<ComplianceWorkEntry["color"], QueueTone> = {
  red: "blocked",
  amber: "attention",
  slate: "neutral",
  green: "done",
};

export function ComplianceWorkspace({
  entries,
  cards,
  info,
  selectedId,
  /**
   * Whether the URL named this item, as opposed to the page opening the first
   * one for a wide screen. Drives which pane a phone gets.
   */
  opened,
  hrefFor,
  base,
  prevHref,
  nextHref,
  position,
  members,
  viewerId,
  canAssign,
}: {
  entries: ComplianceWorkEntry[];
  /** The full editable projection, by id. */
  cards: Map<string, ComplianceCardData>;
  /** What each item IS, by id, when the category has an explanation. */
  info: Map<string, CategoryInfo | undefined>;
  selectedId: string | null;
  opened: boolean;
  hrefFor: (id: string) => string;
  base: string;
  prevHref: string | null;
  nextHref: string | null;
  position: { index: number; total: number };
  members: Owner[];
  viewerId?: string;
  canAssign: boolean;
}) {
  const card = selectedId ? (cards.get(selectedId) ?? null) : null;
  const about = selectedId ? info.get(selectedId) : undefined;

  const railEntries: QueueEntry[] = entries.map((e) => ({
    id: e.id,
    href: hrefFor(e.id),
    title: e.label,
    context: e.area,
    meta: e.countdownText,
    state: { label: e.statusLabel, tone: TONE[e.color] },
    /*
     * A green item is finished, and a finished item is ticked rather than
     * removed: a list that shortens as you work gives no sense of progress,
     * and the ones already in order are the proof that the order is right.
     */
    done: e.color === "green",
  }));

  return (
    <>
      <QueueKeys prevHref={prevHref} nextHref={nextHref} closeHref={base} />
      <WorkspaceShell
        selected={opened}
        queueLabel="Renewals"
        queueWidth="lg:w-[360px]"
        queue={
          <QueueRail
            entries={railEntries}
            selectedId={selectedId}
            heading="Work through them"
            summary="Overdue first, then whatever lands soonest."
            toolbar={
              <div className="flex flex-wrap gap-1.5">
                <KeyHint keys="J / K" label="move" />
                <KeyHint keys="Esc" label="back to the board" />
              </div>
            }
            empty={
              <EmptyState
                tone="success"
                title="Nothing to renew"
                description="Every tracked item has a date and none of them is close."
                action={
                  <Link href="/compliance" className="btn-ghost text-sm">
                    Back to the board
                  </Link>
                }
              />
            }
          />
        }
        primary={
          card ? (
            <WorkspacePane
              header={
                <div>
                  <Link
                    href={base}
                    className="tap mb-2 inline-flex text-xs text-muted-foreground hover:text-accent lg:hidden"
                  >
                    Back to the board
                  </Link>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="eyebrow mb-1">Renewal</p>
                      <h2 className="truncate text-base font-medium text-foreground">
                        {card.label}
                      </h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {card.statusDetail}
                      </p>
                    </div>
                    <span className="num shrink-0 text-xs text-muted-foreground">
                      {position.index + 1} of {position.total}
                    </span>
                  </div>
                </div>
              }
              footer={
                <div className="flex flex-wrap items-center gap-2">
                  {/*
                    No "mark done" here. Finishing a renewal means changing the
                    date or attaching the certificate, and both live on the card
                    above with the validation that belongs to them. A second
                    button down here that only moved the row along would be a
                    way to make an expired registration look handled.
                  */}
                  <SkipAction
                    nextHref={nextHref}
                    doneHref={base}
                    label={nextHref ? "Next renewal" : "Back to the board"}
                    className="btn-primary text-sm"
                    shortcut="mod+Enter"
                  />
                  <Link href={base} className="btn-ghost text-sm">
                    Show the whole board
                  </Link>
                </div>
              }
            >
              <ComplianceItemCard
                item={card}
                info={about}
                members={members}
                viewerId={viewerId}
                canAssign={canAssign}
              />
            </WorkspacePane>
          ) : (
            <WorkspacePlaceholder>
              Pick a renewal to set its date, attach the certificate, and say who is
              doing it. The list is ordered by what lapses first.
            </WorkspacePlaceholder>
          )
        }
        contextLabel="What this item is"
        context={
          card ? (
            <div className="space-y-4">
              <ContextSection title="What it is">
                {about?.what ? (
                  <p className="text-sm text-foreground">{about.what}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    An item somebody on this account added. Its meaning is whatever
                    the notes on it say.
                  </p>
                )}
              </ContextSection>

              {about?.how && (
                <ContextSection title="How it is renewed">
                  <p className="text-sm text-foreground">{about.how}</p>
                </ContextSection>
              )}

              <ContextSection title="Where it stands">
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      State
                    </dt>
                    <dd className="text-foreground">{card.statusLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Due
                    </dt>
                    <dd className={card.dueDisplay === "-" ? "text-muted-foreground" : "text-foreground"}>
                      {card.dueDisplay === "-" ? "No date set, so nothing counts down" : card.dueDisplay}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Countdown
                    </dt>
                    <dd className="text-foreground">{card.countdownText}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Certificate on file
                    </dt>
                    <dd
                      className={
                        card.documents.length > 0 ? "text-foreground" : "text-review"
                      }
                    >
                      {card.documents.length > 0
                        ? `${card.documents.length} stored`
                        : "Nothing stored. A link is not a document a contracting officer can be sent."}
                    </dd>
                  </div>
                </dl>
              </ContextSection>

              {card.statusFix && (
                <ContextSection title="What to do">
                  <p className="text-sm text-foreground">{card.statusFix}</p>
                </ContextSection>
              )}

              {about?.links && about.links.length > 0 && (
                <ContextSection title="Where to renew it">
                  <ul className="space-y-1.5 text-sm">
                    {about.links.map((l) => (
                      <li key={l.url}>
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-accent underline-offset-2 hover:underline"
                        >
                          {l.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </ContextSection>
              )}
            </div>
          ) : undefined
        }
      />
    </>
  );
}
