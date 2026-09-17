import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { IndustrySlider } from "@/components/marketing/industry-slider";
import { IndustryRibbon } from "@/components/marketing/industry-ribbon";
import { INDUSTRIES } from "@/components/marketing/industry-content";

describe("continuous industry discovery", () => {
  for (const [name, Component] of [["cards", IndustrySlider], ["ribbon", IndustryRibbon]] as const) {
    it(`renders all sectors without JavaScript and hides the seamless copy from assistive technology: ${name}`, () => {
      const { document } = parseHTML(renderToStaticMarkup(<Component />));
      const track = document.querySelector(".bco-continuous-track")!;
      const lists = track.querySelectorAll("ul");
      expect(lists.length).toBe(2);
      expect(lists[0].hasAttribute("aria-hidden")).toBe(false);
      expect(lists[1].getAttribute("aria-hidden")).toBe("true");
      expect(lists[0].children.length).toBe(INDUSTRIES.length);
      expect(lists[0].textContent).toBe(lists[1].textContent);
      expect(track.querySelectorAll("button, a, [tabindex]").length).toBe(0);
    });
  }
});
