import type { QaItem } from "../../qa";

export const order = 163;

export default {
  id: "partia-inne",
  title: "Partia „Inne” dla powiązań politycznych spoza głównych partii",
  description:
    "Osobie można teraz przypisać partię „Inne”, gdy znaleźliśmy jej powiązanie polityczne, ale nie z żadną z głównych partii. " +
    "Wszędzie, gdzie widać partię, „Inne” jest wyszarzone - bladoszary chip z szarym napisem, szara kropka na grafie - żeby nie wyglądało jak kolejna partia.",
  steps: [
    "Na stronie dowolnej osoby kliknij „Zaproponuj zmianę” - na końcu listy „Przynależność partyjna” ma być „Inne”.",
    "Otwórz tabelę z filtrem „Inne” - chip filtra nad tabelą ma być bladoszary z szarym napisem, a nie w kolorze którejś partii.",
  ],
  link: "/eksploruj/tabela?party=Inne",
  area: "contributor",
} satisfies QaItem;
