# UI (`frontend/app`)

Read together with `frontend/CLAUDE.md` and `.interface-design/system.md`.

## Vuetify and design system

- Set component defaults in Vuetify global defaults (`shared/vuetifyDefaults.ts`, handed
  to `vuetifyOptions.defaults` in `nuxt.config.ts` and to the Storybook preview), not
  per-instance props repeated across files.
  Why: one place to change the look, and instances cannot drift apart.
- Colours come only from `shared/colors.ts` (exposed as theme tokens); no hex values
  or ad-hoc colour names in components or styles. A new colour gets a contrast test
  in `tests/shared/colors.test.ts`.
  Why: the contrast tests check exactly what Vuetify paints.
- Design-system pieces (shared components under `components/`) have a Storybook story
  in `frontend/stories/` (`npm run storybook`); update it when you change the component.
  Why: the story is where a piece is reviewed in isolation and in every state.
- Boy-scout rule here: when you touch a design-system component, move its repeated props
  to global defaults/theme tokens and add or update its story. Do not restyle files the
  change does not otherwise touch.
- Reuse existing components and composables (see the `relation-surfaces` skill) before
  writing new ones.

## Accessibility (WCAG 2.2 AA)

- Focus is always visible; never remove the outline without a replacement.
- Every control has an accessible name (visible label, `aria-label` for icon buttons).
- Respect `prefers-reduced-motion` for animations and transitions.
- No information only in a tooltip, colour or hover state; it must also be readable
  as text and reachable by keyboard.
  Why: these are the failures that lock out keyboard, screen-reader and touch users.

## Review

- A visible UI change goes through the `design-feedback` skill round before it is
  considered done.
  Why: the look of the site is approved on the board, not in chat.
- A visible change also gets its `shared/qa.ts` entry (see `frontend/CLAUDE.md`).
