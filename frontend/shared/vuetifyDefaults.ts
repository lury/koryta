/**
 * Vuetify's global component defaults, handed to `vuetifyOptions.defaults` in
 * nuxt.config.ts and to the Storybook preview, so both draw the same widgets.
 *
 * A default here is either an accessibility fix every instance needs, or the
 * value most call sites were already passing by hand - a prop that more than
 * half of them spelled out is the de facto default, and writing it once keeps
 * the rest from drifting. A call site that passes its own value still wins.
 */

/** How long the pointer rests on an activator before its tooltip opens. Long
 * enough that sweeping across a table row does not set off a trail of
 * bubbles, short enough to answer somebody who stopped to ask. */
export const TOOLTIP_OPEN_DELAY = 500;

/** How long a tooltip stays after the pointer leaves, so it can be reached and
 * hovered (WCAG 1.4.13) rather than vanishing on the way to it. */
export const TOOLTIP_CLOSE_DELAY = 100;

export const vuetifyDefaults = {
  VTooltip: {
    openDelay: TOOLTIP_OPEN_DELAY,
    closeDelay: TOOLTIP_CLOSE_DELAY,
    // Vuetify's own pick is `scale-transition`, a bubble growing out of a dot
    // in 300ms. A fade says the same thing without the motion, and the global
    // reduced-motion rule in app.vue takes even that away when asked.
    transition: "fade-transition",
    // `end` is Vuetify's default; the call sites split 27 bottom / 25 top and
    // the few that passed nothing were drawn beside the activator, over the
    // next column of a table.
    location: "top",
    maxWidth: 320,
    // Hoverable content (WCAG 1.4.13): the pointer can move onto the bubble to
    // read or select it without it closing underneath.
    interactive: true,
  },
  // 22 of 36 selects and 8 of 10 autocompletes already asked for these.
  VSelect: {
    variant: "outlined",
    density: "compact",
  },
  VAutocomplete: {
    variant: "outlined",
  },
} as const;
