import type { QaItem } from "../../qa";

export const order = 188;

export default {
  id: "admin-procesy-rejestr-nowe-spolki",
  title: "Procesy: nowo zarejestrowane spółki czytane co noc",
  description:
    "Przegląd rejestru KRS jest teraz krokiem nocy: co noc czyta właścicieli każdej spółki, którą biuletyn podaje jako nowo zarejestrowaną, więc spółka założona przez gminę czy powiat trafia do crawla bez szukania jej ręcznie.",
  steps: [
    "Rano otwórz /admin/procesy i rozwiń „Przegląd rejestru KRS (właściciele)” - ma pokazać harmonogram „codziennie o 04:30” i ostatnie uruchomienie z nocy (po weekendzie może mieć zero odczytów).",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
