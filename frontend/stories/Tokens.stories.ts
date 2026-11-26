import type { Meta, StoryObj } from "@storybook/vue3-vite";
import {
  AA_LARGE_TEXT,
  AA_TEXT,
  brand,
  contrastRatio,
  ink,
  readableInkOn,
  role,
  statusFill,
  surface,
} from "../shared/colors";

/** One swatch: the colour, its name, and what it measures against the
 * background it is meant for. Every ratio is computed here from
 * shared/colors.ts, never typed in, so the page cannot drift from the palette. */
type Swatch = { name: string; hex: string; on: string; onName: string };

const swatches = (
  group: Record<string, string>,
  prefix: string,
  on: (hex: string) => [string, string],
): Swatch[] =>
  Object.entries(group).map(([name, hex]) => {
    const [onHex, onName] = on(hex);
    return { name: `${prefix}.${name}`, hex, on: onHex, onName };
  });

const groups = [
  {
    title: "ink.* - tekst i ikony (na białym)",
    items: swatches(ink, "ink", () => [surface.white, "surface.white"]),
    asText: true,
  },
  {
    title: "surface.* - tła pastylek, z tuszem tej samej nazwy",
    items: swatches(surface, "surface", (hex) => {
      const name = Object.entries(surface).find(([, v]) => v === hex)?.[0];
      const pair = (ink as Record<string, string>)[name ?? ""] ?? ink.strong;
      return [pair, `ink.${name && name in ink ? name : "strong"}`];
    }),
    asText: false,
  },
  {
    title: "brand.* - wypełnienia (nie tekst)",
    items: swatches(brand, "brand", (hex) => [readableInkOn(hex), "czytelny"]),
    asText: false,
  },
  {
    title: "statusFill.* - wypełnienia Vuetify (nie tekst)",
    items: swatches(statusFill, "statusFill", (hex) => [
      readableInkOn(hex),
      "czytelny",
    ]),
    asText: false,
  },
  {
    title: "role.* - części strony",
    items: swatches(role as Record<string, string>, "role", (hex) => [
      readableInkOn(hex),
      "czytelny",
    ]),
    asText: false,
  },
];

const meta: Meta = {
  title: "Design system/Kolory",
  parameters: {
    docs: {
      description: {
        component:
          "Paleta z `shared/colors.ts` z kontrastem liczonym na żywo. AA: 4.5:1 dla tekstu, 3:1 dla dużego tekstu i krawędzi.",
      },
    },
  },
};
export default meta;

export const Paleta: StoryObj = {
  // A page of swatches with nothing to focus; the document scrolls with the
  // keyboard as any page does. axe asks for a focusable element inside a
  // scrolling region and counts <html> as one here because Vuetify sets its
  // overflow.
  parameters: {
    a11y: {
      config: {
        rules: [{ id: "scrollable-region-focusable", enabled: false }],
      },
    },
  },
  render: () => ({
    setup: () => ({
      groups,
      card: {
        width: "200px",
        border: `1px solid ${ink.neutral}`,
        borderRadius: "8px",
        overflow: "hidden",
      },
      caption: { background: surface.white, color: ink.strong },
      ratio: (a: string, b: string) => contrastRatio(a, b).toFixed(2),
      verdict: (a: string, b: string) => {
        const r = contrastRatio(a, b);
        if (r >= AA_TEXT) return "AA";
        if (r >= AA_LARGE_TEXT) return "AA duży";
        return "poniżej AA";
      },
    }),
    template: `
      <div class="d-flex flex-column ga-6">
        <section v-for="group in groups" :key="group.title">
          <h2 class="text-h6 mb-2">{{ group.title }}</h2>
          <ul class="d-flex flex-wrap ga-3 pa-0" style="list-style: none">
            <li v-for="s in group.items" :key="s.name" :style="card">
              <div v-if="group.asText"
                   :style="{ background: s.on, color: s.hex, padding: '16px', fontWeight: 600 }">
                Aa tekst
              </div>
              <div v-else
                   :style="{ background: s.hex, color: s.on, padding: '16px', fontWeight: 600 }">
                Aa tekst
              </div>
              <div class="pa-2 text-caption" :style="caption">
                <div><code>{{ s.name }}</code> {{ s.hex }}</div>
                <div>{{ ratio(s.hex, s.on) }}:1 z {{ s.onName }} - {{ verdict(s.hex, s.on) }}</div>
              </div>
            </li>
          </ul>
        </section>
      </div>`,
  }),
};
