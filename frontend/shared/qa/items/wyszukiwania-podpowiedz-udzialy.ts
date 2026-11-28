import type { QaItem } from "../../qa";

export const order = 235;

export default {
  id: "wyszukiwania-podpowiedz-udzialy",
  title: "Dymek wykresu wyszukiwań w udziałach podaje procenty",
  description:
    "W widoku „Udział” dymek nad kolumną pokazywał liczbę wyszukiwań z dopisanym „%”, np. „19%” zamiast 50%. Teraz podaje udział w kolumnie i liczbę: „50% (19)”.",
  steps: [
    "Na /admin/wyszukiwania, w widoku „Udział”, najedź na kolumnę. Procenty w dymku mają się sumować do około 100%, a w nawiasie ma być liczba wyszukiwań. W widoku „Liczba” dymek podaje same liczby.",
  ],
  link: "/admin/wyszukiwania",
  area: "admin",
} satisfies QaItem;
