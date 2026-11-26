import { describe, it, expect } from "vitest";
import {
  TOOLTIP_CLOSE_DELAY,
  TOOLTIP_OPEN_DELAY,
  vuetifyDefaults,
} from "../../shared/vuetifyDefaults";

describe("vuetifyDefaults", () => {
  it("delays tooltips, fades them and keeps them hoverable", () => {
    expect(vuetifyDefaults.VTooltip).toEqual({
      openDelay: TOOLTIP_OPEN_DELAY,
      closeDelay: TOOLTIP_CLOSE_DELAY,
      transition: "fade-transition",
      location: "top",
      maxWidth: 320,
      interactive: true,
    });
    // Zero was Vuetify's own, and the reason a row of a table lit up with
    // bubbles as the pointer crossed it.
    expect(TOOLTIP_OPEN_DELAY).toBeGreaterThanOrEqual(300);
    expect(TOOLTIP_CLOSE_DELAY).toBeGreaterThan(0);
  });

  it("names only the components it sets something for", () => {
    expect(Object.keys(vuetifyDefaults).sort()).toEqual([
      "VAutocomplete",
      "VSelect",
      "VTooltip",
    ]);
  });
});
