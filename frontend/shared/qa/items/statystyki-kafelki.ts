import type { QaItem } from "../../qa";

export const order = 260;

export default {
  id: "statystyki-kafelki",
  title: "Statystyki: trzy kafelki pod tytułem",
  description:
    "Linki do oświadczeń, rad szpitali i „Pomóż sprawdzać” wyglądają tak samo: kafelek z ikoną, nazwą i jednym zdaniem.",
  steps: [
    "Otwórz /eksploruj/statystyki: pod opisem są trzy kafelki, „Pomóż sprawdzać” ostatni. Każdy prowadzi na swoją stronę.",
  ],
  link: "/eksploruj/statystyki",
  area: "public",
} satisfies QaItem;
