import type { QaItem } from "../../qa";

export const order = 41;

export default {
  id: "eksploruj-nowe-uporzadkowana-strona",
  title: "„Eksploruj nowe” czytelniejsze: trzy kroki i powiązania na wierzchu",
  description:
    "Strona do sprawdzania nowych osób została uporządkowana. Instrukcje " +
    "były pięcioma zdaniami w dużej niebieskiej ramce, która zajmowała " +
    "pół ekranu, zanim widać było kogokolwiek - teraz jest to jeden pasek " +
    "z trzema krokami („Eksploruj”, „Notatka”, „Głos”), które odhaczają " +
    "się same w miarę pracy, a pełne opisy chowają się pod „Jak to " +
    "działa?”. „Historia powiązań” przeniosła się nad kartę osoby i " +
    "notatki: to na jej podstawie ocenia się, czy ktoś jest ciekawy, więc " +
    "nie ma sensu szukać jej na samym dole. Filtry kolejki - kolejność, " +
    "typ podmiotu i próg ocen - stoją teraz razem w jednym pasku zamiast " +
    "w dwóch rzędach po obu stronach paska postępu, a obok nich widać, ile " +
    "osób zostało do sprawdzenia. Przy okazji: „Następna osoba” zawsze " +
    "przechodzi dalej - wcześniej co dziesiąte kliknięcie zostawiało na " +
    "tej samej osobie. Nic z tego nie zmienia tego, kto trafia do kolejki " +
    "ani jak się głosuje.",
  steps: [
    "Wejdź na /eksploruj/nowe zalogowany. Nad tabelą ma być wąski pasek z krokami „1 Eksploruj → 2 Notatka → 3 Głos”, a nie ramka z pięcioma zdaniami.",
    "Kliknij „Jak to działa?” - rozwinie się pełny opis kroków; kliknij jeszcze raz, żeby go schować. Wybór ma przetrwać odświeżenie strony.",
    "Kliknij ikonkę „Eksploruj” w wierszu tabeli - pierwszy krok ma dostać zielony ptaszek.",
    "Zapisz notatkę i oddaj głos - drugi i trzeci krok mają się odhaczyć, ramka paska zzielenieć, a opis kroków sam się schować.",
    "Przewiń w dół: zaraz pod tabelą ma być „Historia powiązań”, a dopiero pod nią karta osoby z wyszukiwarkami i notatki obok niej.",
    "Kliknij „Następna osoba” dziesięć razy z rzędu - za każdym razem ma się pojawić inna osoba niż przed kliknięciem.",
    "Sprawdź pasek filtrów nad krokami: przełącznik kolejności, „Min. suma głosów” i „Typ podmiotu” stoją w jednym rzędzie, a pod nimi zdanie opisujące kolejkę i liczba osób, które zostały.",
    "Zwęź okno do szerokości telefonu - kroki i filtry mają się zawijać, a nie uciekać poza ekran.",
  ],
  link: "/eksploruj/nowe",
  area: "contributor",
} satisfies QaItem;
