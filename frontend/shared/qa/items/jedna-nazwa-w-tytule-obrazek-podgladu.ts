import type { QaItem } from "../../qa";

export const order = 261;

export default {
  id: "jedna-nazwa-w-tytule-obrazek-podgladu",
  title: "Jedno „Koryta.pl” w tytule karty, obrazek w podglądzie linku",
  description:
    "Tytuł karty kończy się jednym „| Koryta.pl”. Link do /o-nas, /pomoc czy /eksploruj/szpitale ma w podglądzie obrazek serwisu.",
  steps: [
    "Otwórz /o-nas i /eksploruj/szpitale: karta to „O nas | Koryta.pl” i „Rady nadzorcze szpitali publicznych | Koryta.pl”.",
    "Wklej https://koryta.pl/pomoc na Facebooku lub Slacku: podgląd ma obrazek serwisu.",
  ],
  link: "/o-nas",
  area: "public",
} satisfies QaItem;
