import type { QaItem } from "../../qa";

export const order = 274;

export default {
  id: "procesy-odpisy-krokiem-nocy",
  title: "Procesy: odpisy pełne jako krok nocy",
  description:
    "Wiersz „Odpisy pełne z wyszukiwarki KRS” mówił, że chodzą ręcznie i bez pory, choć pobiera je noc. Teraz ma porę nocy i wymaga uwagi, gdy noc ich nie pobierze.",
  steps: [
    "Otwórz /admin/procesy: przy „Odpisy pełne z wyszukiwarki KRS” jest „następne:” z 04:30.",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
