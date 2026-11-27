import type { Meta, StoryObj } from "@storybook/vue3-vite";
import HiddenParty from "../app/components/chip/HiddenParty.vue";
import PublicCompany from "../app/components/chip/PublicCompany.vue";
import RelativeDuration from "../app/components/chip/RelativeDuration.vue";
import RevisionStatus from "../app/components/chip/RevisionStatus.vue";
import { proposalStatuses } from "../shared/proposals";

const meta: Meta = { title: "Komponenty/Chipy" };
export default meta;

export const StatusRewizji: StoryObj = {
  render: () => ({
    components: { RevisionStatus },
    setup: () => ({ statuses: proposalStatuses }),
    template: `<div class="d-flex flex-wrap ga-2">
      <RevisionStatus v-for="s in statuses" :key="s" :status="s" />
    </div>`,
  }),
};

export const InstytucjaPubliczna: StoryObj = {
  render: () => ({
    components: { PublicCompany },
    setup: () => ({
      publicCo: { name: "Szpital Wojewódzki", isPublic: true },
      privateCo: { name: "Spółka prywatna", isPublic: false },
    }),
    template: `<div class="d-flex flex-wrap ga-2">
      <PublicCompany :company="publicCo" />
      <PublicCompany :company="privateCo" />
      <PublicCompany :company="{ name: 'Nieznana' }" show-unknown />
    </div>`,
  }),
};

export const CzasTrwania: StoryObj = {
  render: () => ({
    components: { RelativeDuration },
    template: `<div style="max-width: 320px">
      <RelativeDuration start="2019-03-01" end="2023-06-30"
                        min-start="2015-01-01" max-end="2026-11-01" />
    </div>`,
  }),
};

export const UkrytaPartia: StoryObj = {
  render: () => ({
    components: { HiddenParty },
    template: `<HiddenParty />`,
  }),
};
