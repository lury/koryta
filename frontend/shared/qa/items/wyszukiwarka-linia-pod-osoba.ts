import type { QaItem } from "../../qa";

export const order = 282;

export default {
  id: "wyszukiwarka-linia-pod-osoba",
  title: "Linijka pod osobą w wyszukiwarce",
  description:
    "Pod każdą osobą jest linijka: miasto, partia, stanowisko. Imienników da się odróżnić.",
  steps: [
    "Wpisz „robert wó”. Każdy Robert Wójcik ma inną linijkę, np. „Mielec · PiS · Rada miasta 2024”.",
    "Wyloguj się i wpisz to samo. Pod osobą bez strony jest tylko jej ostatnie stanowisko, bez partii.",
  ],
  area: "public",
} satisfies QaItem;
