import type { QaItem } from "../../qa";

export const order = 149;

export default {
  id: "aktywnosc-czytelniejsza",
  title: "Aktywność: każda strona osobno, rodzaj akcji na ikonie",
  description:
    "Nazwy stron pod linijką zlewały się w jeden ciąg tekstu. Teraz każda strona to osobna zielona " +
    "etykieta z ikoną, a kółko przy linijce mówi, czy to ocena, publikacja czy usunięcie.",
  steps: [
    "Wejdź na /aktywnosc - pod każdą linijką strony mają być osobnymi etykietami, a przy linijce kolorowe kółko z ikoną.",
  ],
  link: "/aktywnosc",
  area: "contributor",
} satisfies QaItem;
