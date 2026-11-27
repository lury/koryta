import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/vue3-vite";
import vue from "@vitejs/plugin-vue";
import { mergeConfig } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Storybook on plain Vite rather than through Nuxt: the stories are the
 * design-system pieces, which need Vue, Vuetify and the shared palette but
 * none of the app's modules (Firebase, Sentry, content, SEO) that a Nuxt boot
 * would bring up. A component that needs Nuxt's runtime - a composable such as
 * `useAuthState`, `NuxtLink`, a fetch - is not a story here. */
const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.ts"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: { name: "@storybook/vue3-vite", options: {} },
  core: { disableTelemetry: true },
  viteFinal(viteConfig) {
    // The framework takes the Vue plugin from a project vite.config, and
    // this project has none - Nuxt configures Vite itself.
    return mergeConfig(viteConfig, {
      plugins: [vue()],
      resolve: {
        alias: {
          "~~": root,
          "@@": root,
          "~": `${root}app`,
          "@": `${root}app`,
        },
      },
    });
  },
};

export default config;
