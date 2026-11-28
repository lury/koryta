import type { QaItem } from "../../qa";

export const order = 266;

export default {
  id: "stanowiska-chmurka-w-kolejnosci-linii",
  title: "Chmurka wykresu „Stanowiska” w kolejności linii",
  description:
    "Wiersze chmurki szły w stałej kolejności, więc „Pozostałe województwa” były na dole, choć ich linia jest najwyżej. Teraz idą tak jak linie w danym miesiącu, od najwyższej.",
  steps: [
    "Otwórz /?widok=stanowiska, wybierz „Województwa” i najedź na ostatni miesiąc: pierwszy wiersz to „Pozostałe województwa”.",
    "Przy „Partie” najedź na listopad 2026, a potem na czerwiec 2021: PO i PiS zamieniają się miejscami, tak jak ich linie.",
  ],
  link: "/?widok=stanowiska",
  area: "public",
} satisfies QaItem;
