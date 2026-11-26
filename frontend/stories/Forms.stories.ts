import type { Meta, StoryObj } from "@storybook/vue3-vite";

const meta: Meta = { title: "Design system/Pola formularzy" };
export default meta;

export const Pola: StoryObj = {
  render: () => ({
    setup: () => ({ parties: ["PO", "PiS", "PSL"] }),
    template: `
      <div class="d-flex flex-column ga-4" style="max-width: 420px">
        <v-text-field label="Imię i nazwisko" variant="outlined" density="compact" />
        <v-text-field label="Adres e-mail" variant="outlined" density="compact"
                      model-value="nie-email" :error-messages="['Podaj poprawny adres e-mail']" />
        <v-select label="Partia" :items="parties" />
        <v-autocomplete label="Szukaj partii" :items="parties" />
        <v-textarea label="Notatka" variant="outlined" rows="3" />
        <v-checkbox label="Pokaż moją nazwę w statystykach" />
        <v-text-field label="Pole wyłączone" variant="outlined" density="compact" disabled />
        <v-alert type="info">Komunikat informacyjny (tonal, ink-info)</v-alert>
        <v-alert type="warning">Ostrzeżenie (tonal, ink-warning)</v-alert>
        <v-alert type="success">Sukces (tonal, ink-success)</v-alert>
        <v-alert type="error">Błąd (tonal)</v-alert>
      </div>`,
  }),
};
