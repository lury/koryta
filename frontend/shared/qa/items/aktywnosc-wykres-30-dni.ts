import type { QaItem } from "../../qa";

export const order = 154;

export default {
  id: "aktywnosc-wykres-30-dni",
  title: "Na górze Aktywności jest wykres ostatnich 30 dni",
  description:
    "Nad listą wpisów widać, ile zmian było każdego dnia przez ostatnie 30 dni, ile razem i od ilu osób. Link „Pełne statystyki” prowadzi do /eksploruj/statystyki.",
  steps: [
    "Otwórz /aktywnosc - nad filtrami ma być niebieskie pole z liczbą zmian i wykres. Najedź na słupek (na telefonie dotknij go) - ma pokazać, jakie zmiany były tego dnia.",
    "Kliknij „Pełne statystyki” - ma się otworzyć /eksploruj/statystyki.",
  ],
  link: "/aktywnosc",
  area: "contributor",
} satisfies QaItem;
