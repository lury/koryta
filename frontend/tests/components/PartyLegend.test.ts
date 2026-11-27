import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PartyLegend from "../../app/components/PartyLegend.vue";
import PartyChip from "../../app/components/PartyChip.vue";

const mountLegend = (parties: string[]) =>
  mount(PartyLegend, {
    props: { parties },
    global: { components: { PartyChip } },
  });

describe("PartyLegend", () => {
  it("names each party on the page once, in full, „Inne” last", () => {
    const wrapper = mountLegend(["Inne", "PiS", "PO", "PiS"]);

    const names = wrapper.findAll("li > span:last-child").map((s) => s.text());
    expect(names).toEqual([
      "Platforma Obywatelska (Koalicja Obywatelska)",
      "Prawo i Sprawiedliwość",
      "Inne ugrupowanie, spoza głównych partii",
    ]);
    const chips = wrapper.findAll("li .chip").map((chip) => chip.text());
    expect(chips).toEqual(["PO", "PiS", "Inne"]);
  });

  it("hides the chips from a screen reader, which reads the name after them", () => {
    const wrapper = mountLegend(["PSL"]);
    expect(wrapper.get("li [aria-hidden='true'] .chip").exists()).toBe(true);
  });

  it("draws nothing for a page without parties", () => {
    expect(mountLegend([]).find(".party-legend").exists()).toBe(false);
  });
});
