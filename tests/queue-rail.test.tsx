import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueueRail, type QueueEntry } from "../components/workspace/queue-rail";
import {
  ContextSection,
  WorkspacePane,
  WorkspaceShell,
} from "../components/workspace/workspace-shell";

/**
 * The queue rail's whole job is to say what there is and where you are in it,
 * and both of those are one off-by-one away from lying to somebody working
 * fast. Asserted on the rendered output rather than on the props that feed it.
 */

function entries(n: number): QueueEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    href: `/q?i=id-${i}`,
    title: `Item ${i}`,
    context: `Job ${i}`,
  }));
}

function rail(props: Partial<Parameters<typeof QueueRail>[0]> = {}) {
  return renderToStaticMarkup(
    <QueueRail entries={entries(3)} selectedId="id-1" {...props} />
  );
}

describe("the numbered rail", () => {
  it("numbers from one, padded, so the column does not jitter at ten", () => {
    const html = rail();
    expect(html).toContain(">01<");
    expect(html).toContain(">02<");
    expect(html).toContain(">03<");
  });

  it("says which one you are on, not just how many there are", () => {
    // The question somebody working a long queue asks every few minutes, and
    // could previously only answer by counting rows above the highlighted one.
    expect(rail({ heading: "Queue" })).toContain("2 of 3");
  });

  it("says nothing about position when nothing is open", () => {
    const html = rail({ selectedId: null, heading: "Queue" });
    expect(html).not.toContain(" of 3");
  });

  it("ticks a finished row rather than removing it", () => {
    /*
     * A queue that shortens as you work gives no sense of progress: forty
     * becoming thirty-nine looks the same as forty.
     */
    const html = renderToStaticMarkup(
      <QueueRail
        entries={[{ ...entries(1)[0], done: true }]}
        selectedId={null}
      />
    );
    expect(html).toContain("✓");
    expect(html).toContain("line-through");
  });

  it("marks the open row for a screen reader, not only in colour", () => {
    expect(rail()).toContain('aria-current="true"');
  });

  it("renders its empty state instead of an empty list", () => {
    const html = renderToStaticMarkup(
      <QueueRail entries={[]} selectedId={null} empty={<p>Nothing here</p>} />
    );
    expect(html).toContain("Nothing here");
    expect(html).not.toContain("<ol");
  });

  it("carries a state word when the row has one", () => {
    const html = renderToStaticMarkup(
      <QueueRail
        entries={[{ ...entries(1)[0], state: { label: "Overdue", tone: "blocked" } }]}
        selectedId={null}
      />
    );
    expect(html).toContain("Overdue");
    expect(html).toContain("text-risk");
  });
});

describe("the shell", () => {
  const panes = {
    queue: <p>QUEUE</p>,
    primary: <p>PRIMARY</p>,
    context: <p>CONTEXT</p>,
  };

  it("renders all three panes once each", () => {
    const html = renderToStaticMarkup(<WorkspaceShell {...panes} selected />);
    expect(html.match(/CONTEXT/g)).toHaveLength(1);
    expect(html.match(/QUEUE/g)).toHaveLength(1);
    expect(html.match(/PRIMARY/g)).toHaveLength(1);
  });

  it("labels each pane, so a screen reader can move between them", () => {
    const html = renderToStaticMarkup(
      <WorkspaceShell {...panes} selected queueLabel="Work queue" />
    );
    expect(html).toContain('aria-label="Work queue"');
    expect(html).toContain('aria-label="Workspace"');
    expect(html).toContain('aria-label="Supporting detail"');
  });

  it("works as two panes when there is no context to show", () => {
    const html = renderToStaticMarkup(
      <WorkspaceShell queue={panes.queue} primary={panes.primary} selected />
    );
    expect(html).not.toContain("Supporting detail");
    expect(html).toContain("PRIMARY");
  });

  it("gives the phone the queue until something is opened", () => {
    const closed = renderToStaticMarkup(<WorkspaceShell {...panes} selected={false} />);
    // The queue is visible and the record column is not, below lg.
    expect(closed).toContain("lg:w-[380px] block");
    expect(closed).toContain("hidden lg:flex");
    // And the other way round once something is open.
    const open = renderToStaticMarkup(<WorkspaceShell {...panes} selected />);
    expect(open).toContain("hidden lg:block");
  });
});

describe("the pane frame", () => {
  it("keeps the foot out of the scrolling area", () => {
    /*
     * A decision button that scrolls away with the text above it is a decision
     * somebody defers.
     */
    const html = renderToStaticMarkup(
      <WorkspacePane header={<p>H</p>} footer={<p>F</p>}>
        <p>BODY</p>
      </WorkspacePane>
    );
    const body = html.indexOf("BODY");
    const foot = html.indexOf("F</p>");
    expect(body).toBeLessThan(foot);
    expect(html).toContain("overflow-y-auto");
  });

  it("renders a context section with its title and note", () => {
    const html = renderToStaticMarkup(
      <ContextSection title="Why this is here" note="A note">
        <p>Body</p>
      </ContextSection>
    );
    expect(html).toContain("Why this is here");
    expect(html).toContain("A note");
  });
});
