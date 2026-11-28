import type { QaItem } from "../../qa";

export const order = 183;

export default {
  id: "zatrudnienia-z-rejestru-bez-przegladu",
  title: "Nowe zatrudnienia opublikowanych osób publikują się same",
  description:
    "Gdy import dodaje zatrudnienie osobie już opublikowanej, z tego samego wpisu rejestr.io, do którego prowadzi jej strona, i powtarza przy tym choć jedno z jej opublikowanych zatrudnień, nowe powiązanie jest od razu zatwierdzone i widoczne. Pozostałe nowe zatrudnienia dalej czekają na przegląd.",
  steps: [
    "Po nocnym imporcie otwórz stronę opublikowanej osoby, której przybyło zatrudnienie - nowe powiązanie ma być widoczne bez logowania, a na /admin/krawedzie ma go nie być.",
  ],
  link: "/admin/krawedzie",
  area: "admin",
} satisfies QaItem;
