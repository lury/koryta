import type { QaItem } from "../../qa";

export const order = 310;

export default {
  id: "wyszukiwarka-kategorie",
  title: "Wyszukiwarka znajduje kategorie, np. „skarbu państwa”",
  description:
    "Kategorię (sektor, „Skarb Państwa”, „W likwidacji”) można wpisać w wyszukiwarkę, także odmienioną albo bez polskich liter. Wynik otwiera tabelę z tym filtrem.",
  steps: [
    "Wpisz w wyszukiwarkę „skarbu państwa”: jest wynik „Skarb Państwa” z podpisem „Kategoria”.",
    "Kliknij go: tabela pokazuje osoby ze spółek Skarbu Państwa, a na pasku filtrów jest „Skarb Państwa”.",
    "Wpisz „spolkach skarbu panstwa”, „szpitali” albo „kolejowe”: każde daje swoją kategorię.",
    "Kliknij puste pole wyszukiwarki: kategorie są na liście za partiami.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
