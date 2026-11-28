import type { QaItem } from "../../qa";

export const order = 93;

export default {
  id: "szpitale-bez-ostrzezen-hydracji-po-zalogowaniu",
  title: "Strona szpitali nie zgłasza błędów hydracji po zalogowaniu",
  description:
    "Zalogowany czytelnik dostawał w konsoli kilkanaście ostrzeżeń Vue i " +
    "stronę zbudowaną na nowo; teraz kto czyta, strona sprawdza dopiero po " +
    "wczytaniu i wtedy dociąga świeże liczby.",
  steps: [
    "Zalogowany otwórz /eksploruj/szpitale z otwartą konsolą: żadnych „Hydration … mismatch”, a zestawienie i linki „Zobacz osoby” są na miejscu.",
  ],
  link: "/eksploruj/szpitale",
  area: "contributor",
} satisfies QaItem;
