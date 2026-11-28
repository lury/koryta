import type { QaItem } from "../../qa";

export const order = 83;

export default {
  id: "model-ocenia-po-artykulach",
  title: "Osoby z artykułami w bazie trafiają wyżej w kolejce",
  description:
    "Nowy model oceniający („Artykuły w bazie”) bierze pod uwagę fakty " +
    "wyciągnięte z artykułów i dopasowane do konkretnej osoby. Im o więcej " +
    "różnych artykułów chodzi, tym wyżej - kilka faktów z jednego tekstu to " +
    "wciąż jedno źródło. Fakt, który ktoś oznaczył jako błędny albo jako " +
    "dotyczący innej osoby, przestaje się liczyć.",
  steps: [
    "Wejdź na /eksploruj/tabela i kliknij wynik osoby, o której mamy artykuły.",
    "Sprawdź, że na liście modeli jest „Artykuły w bazie”.",
  ],
  link: "/eksploruj/tabela",
  area: "contributor",
} satisfies QaItem;
