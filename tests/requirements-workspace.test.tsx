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
        req({ id: "r1", label: "Signed SF-1449", disqualifying: true }),
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
