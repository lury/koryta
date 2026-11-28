import type { QaItem } from "../../qa";

export const order = 243;

export default {
  id: "waskie-strony-na-srodku-ekranu",
  title: "Wąskie strony są na środku ekranu",
  description:
    "Strony węższe niż kolumna serwisu, np. /oswiadczenia, /tematy, /admin/zadania i /admin/wyszukiwania, stały przy lewej krawędzi, a obok zostawało puste miejsce. Teraz są na środku.",
  steps: [
    "Na szerokim ekranie otwórz /oswiadczenia, /tematy i /admin/zadania: treść ma po obu stronach tyle samo wolnego miejsca.",
  ],
  link: "/oswiadczenia",
  area: "public",
} satisfies QaItem;
