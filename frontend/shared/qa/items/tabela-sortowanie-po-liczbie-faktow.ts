import type { QaItem } from "../../qa";

export const order = 97;

export default {
  id: "tabela-sortowanie-po-liczbie-faktow",
  title: "Tabelę można ustawić według liczby faktów o osobie",
  description:
    "Tabela porządkowała osoby po ocenach albo po liczbie notatek. " +
    "Doszło trzecie: liczba faktów, które pipeline wydobył o tej osobie z " +
    "artykułów - czyli to, o kim jest najwięcej do przeczytania, a nie " +
    "tylko to, kogo najwięcej osób oceniło. Liczba pokazuje się też pod " +
    "sumą ocen w wierszu, obok liczby notatek.",
  steps: [
    "Wejdź na /eksploruj/tabela i w menu „Sortowanie” wybierz „Liczba faktów” - tabela ma się przeładować, a przycisk pokazać „Fakty” ze strzałką.",
    "To samo z nagłówka: kliknij menu przy kolumnie „Oceny” i wybierz „liczba faktów”; nagłówek ma dopisać, po czym sortuje.",
    "W pierwszych wierszach pod sumą ocen ma się pojawić podpis w rodzaju „5 faktów” (a przy osobie z notatkami „2 notatki · 5 faktów”).",
    "Kliknij nazwisko z góry listy i sprawdź w panelu bocznym (albo na stronie osoby), że faktów faktycznie jest tyle.",
    "Skopiuj link z karty udostępniania - ma zawierać sortBy=factsCount i po otwarciu dawać tę samą kolejność.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
