import type { QaItem } from "../../qa";

export const order = 171;

export default {
  id: "fakt-do-powiazania-na-stronie-osoby",
  title: "„Utwórz powiązanie” przy faktach na stronie osoby",
  description:
    "Fakt o zatrudnieniu albo o relacji z drugą osobą można teraz zapisać jako powiązanie w grafie prosto ze strony osoby, tak jak w kolejce ekstrakcji. Fakt, z którego ktoś już zrobił powiązanie, mówi „Powiązanie utworzone” zamiast proponować to drugi raz.",
  steps: [
    "W „Faktach z artykułów” kliknij „Utwórz powiązanie” przy fakcie o zatrudnieniu, wybierz pracodawcę i zapisz - w miejscu przycisku ma się pojawić „Powiązanie utworzone”, a w „Historii powiązań” szkic.",
  ],
  link: "/osoba/agnieszka-zurek-xQwaKwMSFZeDTc8Tz1Ce",
  area: "contributor",
  fixes: ["xMpU8TquC3q4O3AFFOhg"],
} satisfies QaItem;
