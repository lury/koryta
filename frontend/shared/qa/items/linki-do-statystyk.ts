import type { QaItem } from "../../qa";

export const order = 290;

export default {
  id: "linki-do-statystyk",
  title: "Linki do statystyk",
  description:
    "Na /eksploruj/statystyki prowadzą teraz stopka, liczby na stronie głównej i /o-nas. Z góry /pomoc zniknęły liczba sprawdzonych osób i notka o koncie.",
  steps: [
    "Na stronie głównej obok „Sprawdziliśmy już” kliknij „Statystyki”.",
    "W stopce, pod „Na stronie”, kliknij „Statystyki”.",
    "Na /o-nas, przy „Koryta.pl to przede wszystkim społeczność”, kliknij „Zobacz, kto tworzy koryta.pl”.",
    "Na /pomoc pod tytułem jest tylko jeden akapit, a zaraz pod nim „Możesz sprawdzać osoby”.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
