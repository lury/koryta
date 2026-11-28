import type { QaItem } from "../../qa";

export const order = 51;

export default {
  id: "eksploruj-nowe-tabela-w-karcie",
  title: "„Eksploruj nowe”: tabela mieści się w karcie",
  description:
    "Tabela z osobą wystawała poza prawą krawędź swojej karty - na szerokim " +
    "ekranie widać ją było wiszącą na tle strony, a na laptopie 1280 px " +
    "ostatnie kolumny („Twój głos”, „Widoczność”, „Eksploruj”) były po " +
    "prostu ucięte i nie dało się do nich dojechać żadnym suwakiem. Teraz " +
    "tabela nigdy nie wychodzi poza kartę: jeśli zabraknie miejsca, " +
    "przewija się w środku. Przy okazji zostało pięć kolumn zamiast " +
    "jedenastu - „Osoba”, „Historia”, „Lata pracy”, „Twój głos” i " +
    "„Eksploruj”. Zniknęły „Notatki” (wszystkie notatki są w całości niżej " +
    "na tej samej stronie), „Widoczność” (w tej kolejce zawsze „Szkic”) " +
    "oraz „Głosy łącznie”, której liczba przeniosła się pod nazwisko jako " +
    "„Suma ocen”. Kolejka, sortowanie i głosowanie działają dokładnie tak " +
    "samo. (Od czasu paska zapytania /eksploruj/tabela ma własny, krótszy " +
    "zestaw kolumn - to /eksploruj/nowe zostało z tym opisanym tutaj.)",
  steps: [
    "Wejdź zalogowany na /eksploruj/nowe. Tabela nad kartą osoby ma się kończyć równo z krawędzią białej karty - nic nie ma wystawać poza nią na tło strony.",
    "Ustaw okno na około 1280 px szerokości i sprawdź prawą stronę wiersza: ikona „Eksploruj” i strzałki „Twój głos” mają być widoczne bez przewijania w bok. To są kroki 1 i 3 z paska nad tabelą, więc wcześniej nie dało się ich kliknąć na takim ekranie.",
    "Policz kolumny - mają być dokładnie: „Osoba”, „Historia”, „Lata pracy”, „Twój głos”, „Eksploruj”. Kolumn „Notatki”, „Głosy łącznie” i „Widoczność” już nie ma.",
    "Pod nazwiskiem osoby ma być drobny podpis „Suma ocen: N” - ta sama liczba, która wcześniej stała w kolumnie „Głosy łącznie”.",
    "Przełącz kolejność na „Najwyżej oceniane” i klikaj „Następna osoba”: „Suma ocen” pod nazwiskiem ma maleć albo zostawać taka sama, nigdy rosnąć. To potwierdza, że liczba pod nazwiskiem jest tą, po której sortuje się kolejka.",
    "Przewiń w dół do sekcji „Notatki”: są tam notatki tej osoby, także cudze, w całości - dlatego licznik notatek nie jest już potrzebny w tabeli.",
    "Wejdź na /eksploruj/tabela: na szerokim ekranie pod nazwiskiem nie ma „Sumy ocen”. Po pasku zapytania nie ma tam już kolumn „Notatki” ani „Głosy łącznie” - liczba ocen stoi w kolumnie „Oceny”, a na telefonie wraca jako podpis pod nazwiskiem. Kolumny „Widoczność” nie ma tam już wcale - od czasu kolorów partii zalogowany dostaje w jej miejsce plakietkę „szkic” przy nazwisku.",
    "Zwęź okno do szerokości telefonu i wróć na /eksploruj/nowe: jeśli tabela się nie mieści, ma się przewijać w poziomie wewnątrz karty, a sama strona nie ma jechać w bok.",
  ],
  link: "/eksploruj/nowe",
  area: "contributor",
} satisfies QaItem;
