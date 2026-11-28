import type { QaItem } from "../../qa";

export const order = 90;

export default {
  id: "szpitale-linki-do-obecnych-miejsc",
  title: "Linki ze strony szpitali prowadzą do obecnych członków rad",
  description:
    "Słupki wykresu, lista województw i przyciski „Sprawdzaj osoby ze " +
    "szpitali” i „Cała lista w tabeli” otwierały wszystkich, którzy " +
    "kiedykolwiek zasiadali w radzie szpitala. Teraz każdy z tych linków " +
    "dodaje filtr „obecnie zatrudniony”, więc pokazuje ludzi, którzy " +
    "zasiadają w niej dziś.",
  steps: [
    "Na /eksploruj/szpitale kliknij słupek partii albo „Cała lista w tabeli” - w adresie ma być currentlyEmployed=selected, a w tabeli tylko osoby z trwającym miejscem w szpitalu.",
  ],
  link: "/eksploruj/szpitale",
  area: "public",
} satisfies QaItem;
