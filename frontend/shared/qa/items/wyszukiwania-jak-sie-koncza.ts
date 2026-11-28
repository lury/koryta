import type { QaItem } from "../../qa";

export const order = 232;

export default {
  id: "wyszukiwania-jak-sie-koncza",
  title: "Wykres: jak kończą się wyszukiwania",
  description:
    "Na górze /admin/wyszukiwania jest wykres skuteczności wyszukiwarki. Każde wyszukiwanie z okna liczy się raz, po tym, czym się skończyło: otwarto wynik, znaleziono coś, ale nic nie otwarto, albo nic nie znaleziono. Duża liczba to udział wyszukiwań, w których ktoś coś otworzył. Kolumny pokazują udziały dzień po dniu, a przełączniki w karcie zmieniają je na tygodnie albo na liczby wyszukiwań. Okno (7, 30, 90, 180 dni) i „Tylko niezalogowani” stoją teraz nad wykresem i dotyczą też listy zapytań.",
  steps: [
    "Wejdź na /admin/wyszukiwania (widzi ją tylko właściciel serwisu). Nad listą zapytań ma być karta „Jak kończą się wyszukiwania”: duży procent przy „Otwarto wynik”, obok dwa mniejsze, a pod nimi kolumny dzień po dniu w trzech kolorach, każda do 100%. Najedź na kolumnę - dymek ma podać liczby z tego dnia.",
    "Kliknij w karcie „Tygodnie”, potem „Liczba”. Kolumny mają się zsumować w tygodnie od poniedziałku, a ich wysokość ma pokazywać liczbę wyszukiwań. Dymek nad tygodniem podaje jego dni, np. „19-25 paź”.",
    "Włącz „Tylko niezalogowani” nad kartą. Procenty i kolumny mają się przeliczyć dla samych niezalogowanych.",
  ],
  link: "/admin/wyszukiwania",
  area: "admin",
} satisfies QaItem;
