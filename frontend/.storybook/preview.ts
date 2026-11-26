import type { Preview } from "@storybook/vue3-vite";
import { setup } from "@storybook/vue3-vite";
import { createVuetify } from "vuetify";
// Every component and directive, where the app's build imports only what it
// uses: a story may reach for any of them and the bundle size is no concern.
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { aliases, mdi } from "vuetify/iconsets/mdi-svg";
import "vuetify/styles";
import { themeColors } from "../shared/colors";
import { vuetifyDefaults } from "../shared/vuetifyDefaults";
import InfoBubble from "../app/components/InfoBubble.vue";
import PartyChip from "../app/components/PartyChip.vue";
// The site's global stylesheet lives in app.vue's unscoped <style>; importing
// the component is what puts it on the page.
import "../app/app.vue";

/** The same Vuetify the app builds from nuxt.config.ts: the one light theme,
 * the palette from shared/colors.ts and the global defaults. */
const vuetify = createVuetify({
  components,
  directives,
  icons: { defaultSet: "mdi", aliases, sets: { mdi } },
  defaults: vuetifyDefaults,
  theme: {
    defaultTheme: "light",
    themes: { light: { colors: themeColors } },
  },
});

setup((app) => {
  app.use(vuetify);
  // Nuxt registers components by file name; the few the stories' components
  // reach for without importing are registered by hand.
  app.component("PartyChip", PartyChip);
  app.component("InfoBubble", InfoBubble);
});

const preview: Preview = {
  decorators: [
    () => ({
      template:
        '<v-app><v-main><div style="padding: 24px"><story /></div></v-main></v-app>',
    }),
  ],
  parameters: {
    layout: "fullscreen",
    a11y: {
      // Fail the a11y panel's checks rather than only listing them.
      test: "error",
      options: {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
        },
      },
    },
  },
};

export default preview;
