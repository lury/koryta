import type { Meta, StoryObj } from "@storybook/vue3-vite";

const meta: Meta = { title: "Design system/Typografia" };
export default meta;

const styles = [
  ["text-h4", "Nagłówek strony"],
  ["text-h5", "Nagłówek karty"],
  ["text-h6", "Nagłówek sekcji"],
  ["text-subtitle-1", "Podtytuł"],
  ["text-body-1", "Tekst główny - Roboto 16px, 400."],
  ["text-body-2", "Tekst w tabeli i na kartach - 14px."],
  ["text-caption", "Podpis, meta, data - 12px, dolna granica czytelności."],
] as const;

export const Skala: StoryObj = {
  render: () => ({
    setup: () => ({ styles }),
    template: `
      <div class="d-flex flex-column ga-3">
        <div v-for="[cls, text] in styles" :key="cls">
          <code class="text-caption text-ink-neutral">{{ cls }}</code>
          <div :class="cls">{{ text }}</div>
        </div>
        <p class="text-body-2">
          <span class="text-ink-neutral">ink-neutral (meta)</span> ·
          <span class="text-ink-sage">ink-sage</span> ·
          <span class="text-ink-info">ink-info (linki)</span> ·
          <span class="text-ink-danger">ink-danger</span> ·
          <span class="text-medium-emphasis">text-medium-emphasis</span>
        </p>
      </div>`,
  }),
};
