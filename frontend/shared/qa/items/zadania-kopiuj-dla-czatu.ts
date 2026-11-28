import type { QaItem } from "../../qa";

export const order = 168;

export default {
  id: "zadania-kopiuj-dla-czatu",
  title: "Zadania: „Kopiuj dla czatu”",
  description:
    "Przycisk w szczegółach zadania kopiuje je razem z tym, skąd się wzięło - notatką w pamięci, sesją agenta, zgłoszeniami - z zależnościami i historią, do wklejenia w rozmowie z agentem. Stronę widzi tylko właściciel serwisu.",
  steps: [
    "Na /admin/zadania otwórz zadanie dodane przez agenta, kliknij „Kopiuj dla czatu” i wklej tekst - ma być w nim tytuł, link, notatka albo sesja, z której zadanie pochodzi, i jego historia.",
  ],
  link: "/admin/zadania",
  area: "admin",
} satisfies QaItem;
