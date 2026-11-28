import type { QaItem } from "../../qa";

export const order = 280;

export default {
  id: "sama-rada-spoleczna-ponizej-progu-kolejki",
  title: "Osoby tylko z radą społeczną poniżej progu kolejki",
  description:
    "Osoba, której jedynym publicznym stanowiskiem jest miejsce w radzie społecznej szpitala, dostaje od modeli najwyżej 2, czyli mniej niż próg kolejki.",
  steps: [
    "Rano otwórz /eksploruj/nowe i wybierz „Najwyżej oceniane”: osoby, które w historii mają tylko „Rada Społeczna”, mają ocenę 2 albo niższą.",
  ],
  link: "/eksploruj/nowe?order=votes",
  area: "contributor",
} satisfies QaItem;
