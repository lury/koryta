import type { QaItem } from "../../qa";

export const order = 39;

export default {
  id: "eksploruj-nowe-kolejnosc-najnowsi",
  title: "„Eksploruj nowe” zaczyna od najnowszych zatrudnień",
  description:
    "Kolejka do sprawdzania miała dotąd jedną kolejność: najwyżej oceniani " +
    "najpierw, niezależnie od tego, czy ktoś objął stanowisko w zeszłym " +
    "miesiącu czy dziesięć lat temu. Doszedł przełącznik z drugą " +
    "kolejnością - „Najnowsze zatrudnienia” - i to ona jest teraz " +
    "domyślna: osoby, które najpóźniej zaczęły pracę, z sumą ocen co " +
    "najmniej 3, żeby kolejka została krótką listą, a nie wszystkim, co " +
    "kiedykolwiek trafiło do bazy. Próg da się zmienić w polu obok, a " +
    "„Najwyżej oceniane” wraca do poprzedniego zachowania. W obu " +
    "kolejnościach wciąż pokazują się tylko osoby, na które nikt jeszcze " +
    "nie zagłosował. Wybór zapisuje się w adresie strony, więc link można " +
    "komuś podać. Filtr typu podmiotu działa jak wcześniej.",
  steps: [
    "Wejdź na /eksploruj/nowe zalogowany. Przełącznik ma stać na „Najnowsze zatrudnienia”, a obok ma być pole „Min. suma głosów” z wartością 3.",
    "Sprawdź w tabeli kolumnę „Ostatnie zatrudnienie” - klikając „Następna osoba” kilka razy, daty powinny iść od najnowszych w dół.",
    "Kolumna „Głosy łącznie” ma pokazywać co najmniej 3 przy każdej osobie.",
    "Zmień próg na 5. Adres ma dostać „minVotes=5”, a osoby z oceną 3 i 4 mają zniknąć.",
    "Wyczyść pole - ma wrócić do 3, bo to wartość domyślna.",
    "Przełącz na „Najwyżej oceniane”. Adres ma dostać „order=votes”, kolejność ma iść od najwyższej sumy ocen, a pole progu ma zniknąć.",
    "Odśwież stronę z takim adresem - przełącznik i próg mają zostać tam, gdzie je ustawiłeś.",
    "Ustaw „Typ podmiotu” na szpitale przy obu kolejnościach - lista ma się zawęzić, a licznik postępu u góry przeliczyć.",
  ],
  link: "/eksploruj/nowe",
  area: "contributor",
} satisfies QaItem;
