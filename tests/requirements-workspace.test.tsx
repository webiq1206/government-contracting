import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BriefRequirement } from "@/lib/domain/opportunity-brief";
import type { RequirementStateView } from "@/lib/domain/requirement-state";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

const { RequirementsWorkspace } = await import("../components/requirements-workspace");

function req(over: Partial<BriefRequirement> & { id: string }): BriefRequirement {
  return {
    label: `Requirement ${over.id}`,
    importance: "required",
    owner: "operator",
    disqualifying: false,
    ...over,
  } as BriefRequirement;
}

function view(over: Partial<RequirementStateView> = {}): RequirementStateView {
  return {
    state: "not_started",
    verification: "upload",
    humanVerified: false,
    owner: null,
    dueAt: null,
    blockingReason: null,
    note: null,
    updatedAt: null,
    updatedBy: null,
    untouched: true,
    ...over,
  };
}

const DOC = {
  id: "d1",
  name: "Solicitation W912-25-R-0042.pdf",
  preview: "pdf" as const,
  pageCount: 84,
};

function render(props: Partial<Parameters<typeof RequirementsWorkspace>[0]> = {}) {
  return renderToStaticMarkup(
    <RequirementsWorkspace
      opportunityId="opp-1"
      requirements={[
        req({ id: "r1", label: "Signed SF-1449", disqualifying: true, disqualifyingReason: "The solicitation states this as a condition of a valid bid." }),
        req({ id: "r2", label: "Pricing schedule" }),
        req({ id: "r3", label: "Past performance references" }),
      ]}
      states={{ r3: view({ state: "done", untouched: false }) }}
      history={{}}
      documents={[DOC]}
      members={[]}
      canEdit
      recordHref="/opportunity/opp-1#requirements"
      {...props}
    />
  );
}

describe("the checklist beside its source", () => {
  it("initially opens the effective requirement's second PDF at its recorded page", () => {
    const html = render({ requirements: [req({ id: "r1", sourceDocumentId: "d2", sourcePage: 44 })],
      documents: [DOC, { ...DOC, id: "d2", name: "Second source.pdf" }] });
    expect(html).toContain('src="/api/documents/d2/open?page=44"');
    expect(html).not.toContain('src="/api/documents/d1/open"');
  });
  it("uses the filtered first open requirement rather than the completed first row's document", () => {
    const html = render({ requirements: [req({ id: "done", sourceDocumentId: "d1", sourcePage: 2 }),
      req({ id: "open", sourceDocumentId: "d2", sourcePage: 44 })], states: { done: view({ state: "done" }) },
      documents: [DOC, { ...DOC, id: "d2", name: "Second source.pdf" }] });
    expect(html).toContain('src="/api/documents/d2/open?page=44"');
  });
  it("keeps populated research requirements readable without bid-work framing", () => {
    const html = render({ researchOnly: true, canEdit: false, documents: [] });
    expect(html).toContain("Recorded requirements");
    expect(html).toContain("Signed SF-1449");
    expect(html).not.toContain("What it takes to bid");
    expect(html).not.toContain("Can sink the bid");
    expect(html).not.toContain("stored against this bid");
    expect(html).not.toContain("condition of a valid bid");
  });
  it("preserves audit history when research requirements cannot be edited", () => {
    const html = render({ researchOnly: true, canEdit: false, history: { r1: [{
      id: "saved-audit", fromState: "not_started", toState: "in_progress",
      actorKind: "person", actorLabel: "Synthetic owner", at: "2026-10-01T12:00:00Z",
      note: "Saved historical requirement note",
    }] } });
    expect(html).toContain("History for ");
    expect(html).toContain("Saved historical requirement note");
    expect(html).not.toContain(">Update</button>");
  });
  it("opens on the first requirement rather than an empty half", () => {
    const html = render();
    expect(html).toContain("Signed SF-1449");
  });

  it("puts the document in the page, not behind a disclosure", () => {
    /*
     * The whole point. The fix this replaces rendered the same file behind a
     * "Preview" toggle on a different tab, so checking a requirement against
     * its source stayed a round trip.
     */
    const html = render();
    expect(html).toContain(`/api/documents/${DOC.id}/open`);
    expect(html).toContain("<iframe");
  });

  it("hides settled requirements by default and says how many there are", () => {
    const html = render();
    // r3 is done, so the default "Still open" view has two of three.
    expect(html).toContain("Pricing schedule");
    expect(html).not.toContain("Past performance references");
    expect(html).toContain("1 of 3 settled.");
  });

  it("marks the one that can sink the bid", () => {
    expect(render()).toContain("Can sink the bid");
  });

  it("says so when nothing readable is stored, rather than showing an empty frame", () => {
    const html = render({ documents: [] });
    expect(html).toContain("Nothing readable is stored against this bid");
    expect(html).not.toContain("<iframe");
  });

  it.each([0, -1, 85, 1.5])("omits the fallback page parameter for invalid stored page %s", sourcePage => {
    const html = render({requirements: [req({id: "r1", sourceDocumentId: DOC.id, sourcePage})]});
    expect(html).toContain('href="/api/documents/d1/open"');
    expect(html).not.toContain("?page=");
  });

  it("offers a way back to the record", () => {
    expect(render()).toContain("/opportunity/opp-1#requirements");
  });

  it("renders an unreadable format as a sentence, not a blank pane", () => {
    const html = render({
      documents: [{ ...DOC, preview: "none" as const }],
    });
    expect(html).toContain("will not render this format");
  });

  it("survives a requirement with no tracking recorded against it", () => {
    // The server builds a view for every requirement; this is the defensive
    // path for a checklist that arrives one item longer than its tracking.
    expect(() => render({ states: {} })).not.toThrow();
  });
});
