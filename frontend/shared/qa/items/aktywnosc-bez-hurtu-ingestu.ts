import type { QaItem } from "../../qa";

export const order = 59;

export default {
  id: "aktywnosc-bez-hurtu-ingestu",
  title:
    "Aktywność liczy decyzje, a nie zapisy: koniec z ingestem i publikowaniem krawędzi na szczycie rankingu",
  description:
    "Wykres i ranking liczyły każdy zapis osobno, więc dominowały je dwie " +
    "rzeczy, które nie są niczyją pracą redakcyjną. Węzły artykułów: każda " +
    "zescrapowana albo przechwycona strona zakładała węzeł i liczyła się " +
    "jako „propozycja zmiany” (48 z 51 propozycji najaktywniejszej osoby w " +
    "ostatnich 30 dniach). Oraz publikowanie: opublikowanie osoby z " +
    "kilkunastoma powiązaniami zostawiało w dzienniku ~25 wpisów i tyleż " +
    "kresek na wykresie. Teraz artykuły zakładane przez ingest nie liczą się " +
    "wcale (ale artykuł poprawiony ręcznie — owszem), a publikacja to jedna " +
    "nowa kategoria „Opublikowane osoby” — jedna na stronę, nie jedna na " +
    "powiązanie. Przy okazji wróciły notatki: od 2 sierpnia zapisują datę " +
    "jako znacznik czasu, a nie tekst, i licznik „Źródło lub zgłoszenie” ich " +
    "nie widział — w 30-dniowym oknie pokazywał 18 źródeł zamiast 272.",
  steps: [
    "Otwórz /eksploruj/statystyki i sprawdź, że w kaflach aktywności jest kategoria „Opublikowane osoby” (fioletowa), obok „Decyzji administratora”.",
    "Najedź na nią: opis mówi, że powiązania opublikowane razem ze stroną liczą się raz.",
    "Jako administrator opublikuj osobę z kilkoma powiązaniami, odczekaj do 5 minut (bufor) i sprawdź, że w rankingu przybyła 1 publikacja, a nie tyle, ile było powiązań.",
    "Dodaj artykuł przez /zrodla albo wtyczkę i sprawdź, że licznik „Propozycja zmiany” się nie zmienił.",
    "Dodaj źródło do notatki i sprawdź, że licznik „Źródło lub zgłoszenie” urósł — wcześniej stał w miejscu.",
  ],
  link: "/eksploruj/statystyki",
  area: "public",
} satisfies QaItem;
