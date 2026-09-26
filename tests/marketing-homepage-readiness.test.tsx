import { describe, expect, it, vi } from "vitest";
const { track, after, promo } = vi.hoisted(() => ({
  track: vi.fn(),
  after: vi.fn(),
  promo: vi.fn(),
}));
vi.mock("next/server", () => ({ after }));
vi.mock("@/lib/analytics", () => ({ trackEvent: track }));
vi.mock("@/lib/billing/public-promo", () => ({ loadPublicPromo: promo }));
import HomePage, { metadata } from "@/app/page";

describe("landing response readiness", () => {
  it("renders without waiting for an unavailable analytics write", async () => {
    track.mockReturnValue(new Promise(() => {}));
    promo.mockResolvedValue({ active: false, endsAt: null });
    const rendered = await Promise.race([
      HomePage(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Analytics blocked the page")), 250),
      ),
    ]);
    expect(rendered).toBeTruthy();
    expect(track).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledWith(expect.any(Function));
    after.mock.calls[0][0]();
    expect(track).toHaveBeenCalledWith({ event: "landing_view", path: "/" });
  });
  it("uses one clear platform title without repeating the brand template", () => {
    expect(metadata.title).toEqual({
      absolute: "AI Government Contracting Software | BrostCo",
    });
  });
});
