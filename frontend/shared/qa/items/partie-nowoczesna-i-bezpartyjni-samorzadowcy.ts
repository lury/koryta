import type { QaItem } from "../../qa";

export const order = 124;

export default {
  id: "partie-nowoczesna-i-bezpartyjni-samorzadowcy",
  title: "Nowoczesna i Bezpartyjni Samorządowcy do wyboru",
  description:
    "Obu nazw nie było na liście partii, więc nie dało się ich " +
    "przypisać osobie ani po nich filtrować - osoba z taką partią w " +
    "bazie była po prostu niewidoczna. Teraz są w „Przynależność " +
    "partyjna”, w filtrach tabeli i mają własny kolor plakietki: " +
    "turkusowy dla Nowoczesnej, fioletowy dla Bezpartyjnych " +
    "Samorządowców.",
  steps: [
    "Zaloguj się, otwórz stronę dowolnej osoby i kliknij „Zaproponuj zmianę”.",
    "Rozwiń „Przynależność partyjna” - na końcu listy mają być „Nowoczesna” i „Bezpartyjni Samorządowcy”.",
    "Wybierz jedną z nich, wyślij propozycję i sprawdź, że po zatwierdzeniu przy nazwisku pojawia się kolorowa plakietka z czytelnym napisem (nie szara, nie sam tekst).",
    "Wejdź na /eksploruj/tabela, otwórz filtry i w polu „Partia” sprawdź, że obie nazwy są do wyboru i że filtrowanie po nich działa.",
    "W wąskiej kolumnie i na telefonie „Bezpartyjni Samorządowcy” może być ucięte wielokropkiem - tak ma być, plakietka nie może zabierać miejsca nazwisku.",
  ],
  link: "/eksploruj/tabela",
  area: "contributor",
} satisfies QaItem;
