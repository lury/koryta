/**
 * Escape hides an open tooltip (WCAG 1.4.13 "dismissible").
 *
 * Vuetify 3 keeps tooltips out of its overlay stack, so its own Escape handler
 * never reaches one. This marks the document instead, and app.vue hides every
 * tooltip while the mark is there. Moving the pointer onto something else or
 * moving focus clears it, so the next tooltip opens as usual. The key is not
 * swallowed: a dialog under the tooltip still closes on the same press.
 */
export default defineNuxtPlugin(() => {
  const root = document.documentElement;
  const ATTR = "data-tooltips-dismissed";
  /** The activator the pointer rested on when Escape was pressed: moving
   * within it (onto the icon inside a button) keeps the tooltip hidden. */
  let dismissedOver: Element | null = null;

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!document.querySelector(".v-tooltip > .v-overlay__content")) return;
    root.setAttribute(ATTR, "");
    const hovered = [...document.querySelectorAll(":hover")].at(-1);
    dismissedOver =
      hovered?.closest('[aria-describedby^="v-tooltip"]') ?? hovered ?? null;
  });

  const clear = (event: Event) => {
    if (!root.hasAttribute(ATTR)) return;
    if (
      event.type === "mouseover" &&
      event.target instanceof Node &&
      dismissedOver?.contains(event.target)
    )
      return;
    root.removeAttribute(ATTR);
    dismissedOver = null;
  };
  window.addEventListener("mouseover", clear, { passive: true });
  window.addEventListener("focusin", clear);
});
