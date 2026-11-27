import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { mdiBriefcaseOutline } from "@mdi/js";
import InfoBubble from "../app/components/InfoBubble.vue";
import PageSection from "../app/components/PageSection.vue";

const meta: Meta = { title: "Komponenty/Sekcje" };
export default meta;

export const Sekcja: StoryObj = {
  render: () => ({
    components: { PageSection },
    setup: () => ({ icon: mdiBriefcaseOutline }),
    template: `<PageSection title="Historia powiązań" :icon="icon"
        lead="Stanowiska i członkostwa, od najnowszego."
        info="Powiązania pochodzą z KRS, PKW i zgłoszeń, każde ze źródłem.">
      <div class="k-card pa-3">Wpis</div>
    </PageSection>`,
  }),
};

export const Dymek: StoryObj = {
  render: () => ({
    components: { InfoBubble },
    template: `<div class="sec-head"><h3 class="text-h6">Notatki</h3>
      <InfoBubble label="Notatki">Notatki piszą zalogowani czytelnicy.</InfoBubble>
    </div>`,
  }),
};
