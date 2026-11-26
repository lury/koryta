import type { Meta, StoryObj } from "@storybook/vue3-vite";
import PartyChip from "../app/components/PartyChip.vue";
import PartyLegend from "../app/components/PartyLegend.vue";
import { parties } from "../shared/misc";

const meta: Meta<typeof PartyChip> = {
  title: "Komponenty/PartyChip",
  component: PartyChip,
  args: { party: "PiS" },
  argTypes: { party: { control: "select", options: parties } },
};
export default meta;
type Story = StoryObj<typeof PartyChip>;

export const Jedna: Story = {};

/** Every party the site names, filled - and as a backing PKW recorded,
 * drawn as a frame (decision on 2026-11-17). */
export const WszystkiePartie: Story = {
  render: () => ({
    components: { PartyChip, PartyLegend },
    setup: () => ({ parties }),
    template: `
      <div class="d-flex flex-column ga-4">
        <div class="d-flex flex-wrap ga-2">
          <PartyChip v-for="p in parties" :key="p" :party="p" />
        </div>
        <div class="d-flex flex-wrap ga-2">
          <PartyChip v-for="p in parties" :key="p" :party="p" tie="backing"
                     note="Poparcie kandydatury" />
        </div>
        <PartyLegend :parties="parties" />
      </div>`,
  }),
};
