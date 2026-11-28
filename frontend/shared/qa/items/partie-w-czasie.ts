import type { QaItem } from "../../qa";

export const order = 305;

export default {
  id: "partie-w-czasie",
  title: "„Partie w czasie”: stanowiska wg partii, warstwa na partię",
  description:
    "Nowa wizualizacja na /eksploruj/autograf: ile osób z każdej partii było na stanowisku w danym miesiącu, we wszystkich instytucjach albo w jednym typie podmiotu. Osoby z kilkoma partiami dzielimy po równo, więc w tabeli bywają ułamki.",
  steps: [
    "Otwórz /eksploruj/autograf/partie-w-czasie: warstwy razem dają liczbę osób w danym miesiącu.",
    "Wybierz „Skarb Państwa” w „Typ podmiotu”: tytuł karty to „Stanowiska wg partii: Skarb Państwa”, a PiS rośnie od 2016 i spada w 2024.",
    "Przesuń suwak „Lata”: wykres i tabela obejmują tylko wybrane lata, a adres dostaje ?od= i ?do=.",
    "Najedź na wykres: dymek podaje miesiąc, liczbę osób i udział każdej partii.",
    "Na telefonie przyciski wizualizacji stoją jeden pod drugim, a wybrany ma ciemny napis.",
  ],
  link: "/eksploruj/autograf/partie-w-czasie",
  area: "public",
} satisfies QaItem;
