import type { QaItem } from "../../qa";

export const order = 137;

export default {
  id: "kategorie-firm-na-listach",
  title: "Branża instytucji widoczna na listach firm",
  description:
    "Kategoria („Szpitale”, „Koleje”, „Wodociągi i kanalizacja”…) była " +
    "widoczna tylko na karcie samej instytucji. Teraz pojawia się wszędzie " +
    "tam, gdzie firmy są wypisane listą - w historii powiązań osoby, przy " +
    "spółkach zależnych i właścicielach, na kartach regionu oraz w kanałach " +
    "na stronie głównej i na „Staż”. Dzięki temu z kariery jednej osoby od " +
    "razu widać, że to trzy razy kolej, a nie trzy nazwy z KRS. Każdy " +
    "znacznik prowadzi do filtra z resztą branży.",
  steps: [
    "Wejdź na stronę dowolnej osoby zatrudnionej w spółce z branży (np. kolejowej) i sprawdź „Historia powiązań” - obok nazwy firmy jest znacznik z branżą.",
    "Kliknij ten znacznik - powinien otworzyć tabelę „Eksploruj” przefiltrowaną po tej branży.",
    "Wejdź na stronę spółki matki i sprawdź listy „Spółki zależne” / „Właściciele” - tam też są branże.",
    "Na stronie głównej sprawdź kanał zatrudnień, a na „Staż” karty jubileuszy - branża jest obok znacznika „spółka publiczna”.",
    "Sprawdź osobę zatrudnioną w instytucji bez przypisanej branży - nie powinno pojawić się nic dodatkowego ani puste miejsce.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
