import type { QaItem } from "../../qa";

export const order = 2;

export default {
  id: "cite-existing-relation",
  title: "Artykuł jako źródło istniejącej relacji",
  description:
    "Można wskazać artykuł jako źródło powiązania, które już jest w bazie, " +
    "bez zakładania go od nowa.",
  steps: [
    "Otwórz stronę artykułu i użyj przycisku dodania źródła do istniejącej relacji.",
    "Wybierz osobę i jej pracodawcę, których powiązanie już istnieje.",
    "Wróć na stronę osoby i sprawdź, że artykuł jest wymieniony przy tym zatrudnieniu.",
  ],
  area: "contributor",
} satisfies QaItem;
