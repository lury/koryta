import type { QaItem } from "../../qa";

export const order = 103;

export default {
  id: "graf-legenda-bez-zwijania",
  title: "Legenda grafu stoi na pasku na stałe",
  description:
    "Przycisk „Ukryj legendę” niczego nie załatwiał: legenda i tak była " +
    "domyślnie rozwinięta, a po wejściu na stronę od nowa wracała " +
    "rozwinięta mimo zwinięcia. Był to jeden przycisk więcej do " +
    "przeczytania po drodze do grafu, więc go nie ma - legenda po prostu " +
    "stoi na pasku.",
  steps: [
    "Otwórz stronę osoby z grafem i sprawdź, że legenda jest na pasku, a przycisku „Ukryj legendę” nie ma.",
  ],
  area: "public",
} satisfies QaItem;
