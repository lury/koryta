import type { QaItem } from "../../qa";

export const order = 5;

export default {
  id: "vote-label-under-pill",
  title: "Opis oceny pod pigułką, nie obok",
  description:
    "Etykieta oceny („Grube koryto”, „Ciekawe”) trafiła pod przycisk, żeby " +
    "nie rozpychała wiersza na wąskim ekranie.",
  steps: [
    "Otwórz stronę dowolnej osoby i najedź na ocenę.",
    "Sprawdź na telefonie (albo w wąskim oknie), że opis nie ucina sąsiednich elementów.",
  ],
  area: "public",
} satisfies QaItem;
