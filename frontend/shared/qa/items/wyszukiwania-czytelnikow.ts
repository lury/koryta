import type { QaItem } from "../../qa";

export const order = 206;

export default {
  id: "wyszukiwania-czytelnikow",
  title: "Wyszukiwania: czego szukają czytelnicy",
  description:
    "Wyszukiwarka zapisuje u nas każde zakończone wyszukiwanie - ostatnie zapytanie i to, czy ktoś otworzył wynik - bez danych o szukającym poza tym, czy był zalogowany. /admin/wyszukiwania pokazuje je razem, także te bez wyników i te, które znalazły tylko niezweryfikowane osoby. Stronę widzi tylko właściciel serwisu.",
  steps: [
    "Wpisz w wyszukiwarkę nazwisko, którego nie ma w bazie, i kliknij poza polem; potem wyszukaj kogoś i otwórz wynik.",
    "Na /admin/wyszukiwania oba zapytania są na liście, a pierwsze ma 1 w „Bez wyników”.",
  ],
  link: "/admin/wyszukiwania",
  area: "admin",
} satisfies QaItem;
