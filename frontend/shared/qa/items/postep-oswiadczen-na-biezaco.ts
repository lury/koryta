import type { QaItem } from "../../qa";

export const order = 270;

export default {
  id: "postep-oswiadczen-na-biezaco",
  title: "Postęp oświadczeń na bieżąco",
  description:
    "Liczby w zakładce „Oświadczenia” na głównej i na /oswiadczenia/postep strona liczy co noc, a w ciągu dnia przesuwa osobę, gdy ktoś zostanie opublikowany albo odczyt się rozstrzygnie.",
  steps: [
    "Rano otwórz /oswiadczenia/postep i zapamiętaj liczbę opublikowanych.",
    "Wieczorem odśwież: jeśli w ciągu dnia ktoś został opublikowany z oświadczenia, liczba jest większa, a dzisiejszy słupek urósł.",
  ],
  link: "/oswiadczenia/postep",
  area: "public",
} satisfies QaItem;
