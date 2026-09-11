import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromoCountdown } from "@/components/marketing/promo-countdown";
import { TodayGreeting } from "@/components/today-greeting";

afterEach(() => vi.useRealTimers());

describe("clock-dependent first renders", () => {
  it("keeps the countdown markup identical when hydration crosses a second or the deadline", () => {
    vi.useFakeTimers();
    const render = () => renderToStaticMarkup(<PromoCountdown endsAtIso="2026-09-08T00:00:00Z" />);
    vi.setSystemTime(new Date("2026-09-07T23:59:59Z"));
    const server = render();
    vi.setSystemTime(new Date("2026-09-08T00:00:01Z"));
    expect(render()).toBe(server);
    expect(server).not.toContain("Offer ended");
    expect(server).toContain('aria-busy="true"');
    expect(server).toContain('aria-live="off"');
  });

  it("explains an invalid offer deadline without displaying NaN or claiming the offer expired", () => {
    const html = renderToStaticMarkup(<PromoCountdown endsAtIso="missing-date" />);
    expect(html).toContain("Offer deadline unavailable");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Offer ended");
  });

  it("keeps the greeting stable across different initial clocks", () => {
    vi.useFakeTimers();
    const render = () => renderToStaticMarkup(<TodayGreeting clear={false} actionCount={3} />);
    vi.setSystemTime(new Date("2026-09-07T08:00:00Z"));
    const server = render();
    vi.setSystemTime(new Date("2026-09-08T23:00:00Z"));
    expect(render()).toBe(server);
    expect(server).toContain("Today");
  });
});
