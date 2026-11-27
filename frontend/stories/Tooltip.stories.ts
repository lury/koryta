import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { mdiInformationOutline } from "@mdi/js";

const meta: Meta = {
  title: "Design system/Dymki (VTooltip)",
  parameters: {
    docs: {
      description: {
        component:
          "Globalne ustawienia z `shared/vuetifyDefaults.ts`: otwarcie po 500 ms, zamknięcie po 100 ms, przenikanie zamiast powiększania, nad elementem, można na nie najechać, Esc chowa (plugin w aplikacji), białe tło z ramką.",
      },
    },
  },
};
export default meta;

export const Warianty: StoryObj = {
  render: () => ({
    setup: () => ({ icon: mdiInformationOutline }),
    template: `
      <div class="d-flex flex-wrap ga-6 align-center" style="padding-top: 120px">
        <v-tooltip text="Zwykły dymek z tekstem">
          <template #activator="{ props }">
            <v-btn v-bind="props">Najedź</v-btn>
          </template>
        </v-tooltip>
        <v-tooltip>
          <template #activator="{ props }">
            <v-btn v-bind="props" :icon="icon" variant="text" aria-label="Co to jest" />
          </template>
          <div>Treść w kilku linijkach</div>
          <div class="text-caption">Podpis</div>
          <div class="text-caption text-medium-emphasis">
            Szary dopisek - na białym tle 5.74:1
          </div>
        </v-tooltip>
        <v-tooltip text="Otwarty na stałe, do porównania kolorów" :model-value="true">
          <template #activator="{ props }">
            <span v-bind="props" tabindex="0">Zawsze otwarty</span>
          </template>
        </v-tooltip>
      </div>`,
  }),
};
