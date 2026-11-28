import type { QaItem } from "../../qa";

export const order = 268;

export default {
  id: "lista-wszystkich-osob-zdejmuje-filtry",
  title: "„Lista wszystkich osób” zdejmuje filtry tabeli",
  description:
    "Na przefiltrowanej tabeli ta pozycja wyszukiwarki zostawiała filtry, więc nic się nie zmieniało, nawet przy „Brak danych”. Teraz tabela pokazuje wszystkich, tak jak po wejściu z innej strony.",
  steps: [
    "Na /eksploruj/tabela?party=PiS wybierz w wyszukiwarce „Lista wszystkich osób”: filtr partii ma zniknąć, a tabela ma pokazać wszystkich.",
  ],
  link: "/eksploruj/tabela?party=PiS",
  area: "public",
} satisfies QaItem;
