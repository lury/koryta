import type { QaItem } from "../../qa";

export const order = 55;

export default {
  id: "szpitale-swieze-liczby-dla-zalogowanych",
  title: "Rady nadzorcze szpitali: zalogowany widzi to, co dopiero opublikował",
  description:
    "Liczby na /eksploruj/szpitale są przeliczane drogo, więc odpowiedź " +
    "trzymana jest przez sześć godzin - i to w dwóch miejscach naraz, bo " +
    "kopię trzyma też CDN przed serwerem. Czyszczenie pamięci po publikacji " +
    "nigdy do tej kopii nie sięgało, więc admin, który właśnie opublikował " +
    "członka rady nadzorczej, po odświeżeniu strony i tak widział stan " +
    "sprzed swojej zmiany, bez żadnej informacji o tym. Teraz zalogowany " +
    "czytelnik pyta o świeże dane i dostaje odpowiedź, której CDN nie " +
    "zapisuje; wylogowany dalej dostaje wersję z pamięci, bo to ona jest " +
    "indeksowana. Przy okazji publikacja samej strony, bez zaznaczania " +
    "powiązań, też czyści pamięć serwera - wcześniej nie czyściła nic.",
  steps: [
    "Wejdź na /eksploruj/szpitale wylogowany i zapamiętaj liczbę miejsc w radach nadzorczych.",
    "Zaloguj się jako admin i opublikuj osobę zasiadającą w radzie nadzorczej szpitala razem z jej powiązaniem.",
    "Wróć na /eksploruj/szpitale jako zalogowany i odśwież - liczba ma już uwzględniać tę osobę, bez czekania.",
    "Otwórz tę samą stronę w oknie prywatnym (wylogowany). Tam liczba może być jeszcze stara - to jest zamierzone, wersja publiczna jest z pamięci.",
    "Sprawdź też publikację strony bez zaznaczania powiązań: po niej liczby na /eksploruj/statystyki mają się przeliczyć dla zalogowanego.",
  ],
  link: "/eksploruj/szpitale",
  area: "admin",
} satisfies QaItem;
