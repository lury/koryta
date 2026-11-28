import type { QaItem } from "../../qa";

export const order = 304;

export default {
  id: "eksploruj-bez-karty-grafu",
  title: "Na /eksploruj nie ma już karty „Graf połączeń”",
  description:
    "Karta otwierała /graf bez wybranej instytucji, gdzie był tylko napis „Wybierz miejsce”. Graf instytucji dalej otwiera przycisk „Graf połączeń” na jej stronie.",
  steps: ["Otwórz /eksploruj: jest osiem kart, bez „Graf połączeń”."],
  link: "/eksploruj",
  area: "public",
} satisfies QaItem;
