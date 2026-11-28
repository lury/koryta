import type { QaItem } from "../../qa";

export const order = 311;

export default {
  id: "admin-procesy-rejestr-zaleglosci-predator",
  title: "Procesy: zaległości rejestru KRS czyta predator",
  description:
    "Przegląd rejestru KRS czyta teraz co noc 20 tys. zaległych numerów, na predatorze od 23:00. Nowe spółki dalej czyta krok nocy.",
  steps: [
    "Rano otwórz /admin/procesy i rozwiń „Przegląd rejestru KRS (właściciele)” - „Gdzie” wymienia predatora o 23:00, a wśród uruchomień z nocy jest jedno z hostem szymon@predator i ok. 20 000 odczytów.",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
