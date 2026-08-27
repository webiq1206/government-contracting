import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The two things about the mobile send flow that a refactor loses silently.
 *
 * A phone is where this is actually filled in: the operator has just uploaded
 * six files to a government portal and the confirmation screen is in front of
 * them right now. A minute later it is gone.
 *
 * The desktop form refuses to submit until a proof document already exists on
 * the bid, which on a phone meant leaving the screen for the Files tab and
 * starting again. That is a workflow you cannot finish on a phone. So the
 * camera capture is not a nicety, it is the thing that makes the record
 * possible, and the safe-area padding is what keeps the primary button out
 * from under the home indicator, where a tap either does nothing or dismisses
 * the browser.
 *
 * Both are one attribute each and both look like decoration in a diff.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

const { SentConfirmationFlow, ProofStep } = await import(
  "../components/sent-confirmation-flow"
);

function render() {
  return renderToStaticMarkup(
    <SentConfirmationFlow opportunityId="opp-1" proofOptions={[]} onClose={() => {}} />
  );
}

function renderProof() {
  return renderToStaticMarkup(
    <ProofStep
      options={[]}
      proofDocumentId=""
      uploading={false}
      onChoose={() => {}}
      onFile={() => {}}
    />
  );
}

describe("the mobile send flow", () => {
  it("asks the phone for the rear camera, not the photo library", () => {
    const html = renderProof();
    // `capture="environment"` is what opens the camera directly. Without it
    // the operator is sent to their photo roll to find a screenshot they have
    // not taken yet.
    expect(html).toContain('capture="environment"');
    expect(html).toContain('accept="image/*"');
  });

  it("keeps the controls above the home indicator", () => {
    const html = render();
    expect(html).toContain("env(safe-area-inset-bottom)");
    expect(html).toContain("env(safe-area-inset-top)");
  });

  it("opens on one question rather than the whole form", () => {
    const html = render();
    expect(html).toContain("How did you send it?");
    // The other steps are not rendered at once: that is the difference between
    // a guided flow and the desktop grid with a smaller font.
    expect(html).not.toContain("What proves it arrived?");
    expect(html).toContain("Step");
  });

  it("will not advance until it has been told where the package went", () => {
    const html = render();
    expect(html).toContain("Say where it went");
    expect(html).toContain("disabled=\"\"");
  });

  it("is a dialog, and says so to a screen reader", () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });
});
