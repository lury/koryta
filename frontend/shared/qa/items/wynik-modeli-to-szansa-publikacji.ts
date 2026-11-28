import type { QaItem } from "../../qa";

export const order = 300;

export default {
  id: "wynik-modeli-to-szansa-publikacji",
  title: "Wynik modeli to szansa publikacji",
  description:
    "Część wyniku od modeli to teraz szansa, że sprawdzenie osoby skończy się publikacją: 5 od 90%, 4 od 75%, 3 od 50%, 2 od 15%. Pozostałe modele zostają w „Skąd ten wynik” jako powody. Działa po nocnym przeliczeniu.",
  steps: [
    "Otwórz link i kliknij wynik osoby: pierwsza na liście jest „Szansa publikacji” z przedziałem, a pod listą „Do wyniku liczy się szansa publikacji”.",
  ],
  link: "/eksploruj/tabela?visibility=private&hideVoted=no_votes&sortBy=latestEmploymentStart&sortDesc=true&minVotes=4",
  area: "contributor",
} satisfies QaItem;
