import type { QaItem } from "../../qa";

export const order = 172;

export default {
  id: "fakty-rozwijane",
  title: "Fakty z artykułów jako wiersze, które się rozwija",
  description:
    "Każdy fakt na stronie osoby to teraz krótki wiersz - co mówi i skąd - a cytat, ocena i przyciski pojawiają się dopiero po kliknięciu. Ten sam fakt z kilku artykułów jest jednym wierszem z liczbą źródeł, który rozwija się w cytat z każdego z nich.",
  steps: [
    "Wybierz „Członkostwo partyjne” i kliknij wiersz „Koalicja Obywatelska - PO i Nowoczesna” - ma mówić „2 źródła” i pokazać dwa cytaty, każdy z własnymi przyciskami oceny.",
  ],
  link: "/osoba/rafal-trzaskowski-8rg6MrDfdiRR7YaAvE5O",
  area: "contributor",
  fixes: ["IzZixsXeIRtgftDXSpWG"],
} satisfies QaItem;
