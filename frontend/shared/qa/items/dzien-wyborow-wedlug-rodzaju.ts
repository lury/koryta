import type { QaItem } from "../../qa";

export const order = 207;

export default {
  id: "dzien-wyborow-wedlug-rodzaju",
  title: "Kandydatury do Parlamentu Europejskiego z dniem tych wyborów",
  description:
    "Dzień przy kandydaturze był dobierany po samym roku, więc start do Parlamentu Europejskiego w 2014, 2019 i 2024 roku dostawał dzień wyborów samorządowych albo do Sejmu z tego roku, a kandydatury samorządowe z 2010 roku - dzień wyborów prezydenckich. Teraz dzień zależy też od rodzaju wyborów, a datę wpisaną przy kandydaturze ręcznie strona pokazuje bez zmian.",
  steps: [
    "Na stronie Pawła Kobylińskiego start do Parlamentu Europejskiego z 2019 roku ma datę 2019-05-26, a start do Sejmu z tego samego roku - 2019-10-13.",
  ],
  link: "/osoba/pawel-bronislaw-kobylinski-xFCwXT4EuQUrjyN532Zt",
  area: "public",
} satisfies QaItem;
