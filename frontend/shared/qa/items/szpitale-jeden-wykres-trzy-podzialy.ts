import type { QaItem } from "../../qa";

export const order = 61;

export default {
  id: "szpitale-jeden-wykres-trzy-podzialy",
  title:
    "Szpitale: jeden wykres zamiast trzech, przełączany na partie, województwa albo szpitale",
  description:
    "Strona miała trzy wykresy pod sobą - miejsca według partii, te same " +
    "miejsca według województwa i tabelę tych samych miejsc według " +
    "szpitala - każdy w swojej skali, i nic nie mówiło, że to trzy " +
    "odczyty jednego zbioru. Teraz jest jeden wykres i jedna kontrolka: " +
    "„Podziel według” partii, województwa albo szpitala. Przy podziale na " +
    "województwo i szpital wiersz pokazuje obie liczby naraz: kolorowa " +
    "głowa słupka to miejsca sprawdzone i opublikowane w podziale na " +
    "partie, a cienki szary ogon to zakres, który został do sprawdzenia - " +
    "sama liczba osób z rejestru. Skala jest wspólna dla wszystkich " +
    "wierszy i nikt jej nie poprawia, więc kolor zajmuje tyle miejsca, ile " +
    "naprawdę sprawdziliśmy; czytelność bierze się z wysokości, bo główka " +
    "jest pełnej wysokości, a ogon niski. Podział na partie nie ma " +
    "szarego ogona i tak ma być: nie wiemy, do jakiej partii należą " +
    "niesprawdzone osoby, i nie zgadujemy. " +
    "Przycisk do kolejki pracy przestał być wyszarzony - wyszarzony " +
    "przycisk w wariancie „tonal” nie ma poprawki kontrastu, którą serwis " +
    "stosuje do pozostałych, więc był nieczytelny, i nie mówił, co zrobić. " +
    "Teraz dla niezalogowanych jest to zwykły, czytelny odnośnik " +
    "„Zaloguj się”, który po zalogowaniu wraca na tę samą stronę. " +
    "SLD i Nowa Lewica to ta sama partia po zmianie nazwy i serwis malował " +
    "je tym samym czerwonym, więc były dwoma słupkami, których nie dało się " +
    "ani rozróżnić, ani dodać. Liczymy je teraz razem, jako „Nowa Lewica / " +
    "SLD” — a osoba, która ma na profilu obie nazwy, liczy się raz.",
  steps: [
    "Wejdź na /eksploruj/szpitale i zjedź do „Podział na partie”. Ma być JEDEN wykres, nie trzy.",
    "Nad wykresem stoi jedna kontrolka „Podziel według” z trzema przyciskami: Partii, Województwa, Szpitala. Nie ma osobnych przycisków sortowania.",
    "Zostaw „Partii”: każdy wiersz to jedna partia, słupek jest w całości kolorowy i nie ma szarego ogona. Pod wykresem ma być zdanie tłumaczące, dlaczego go nie ma.",
    "Przełącz na „Województwa”: szesnaście wierszy, każdy z kolorową główką (partie) i cienkim szarym ogonem (reszta do sprawdzenia).",
    "Przełącz na „Szpitala”: to samo, ale wiersze to szpitale. Ma się pokazać pierwsze 25 i przycisk „Pokaż pozostałe N” - liczba musi się zgadzać z resztą listy.",
    "Wiersze są zawsze uporządkowane od największej liczby ZNALEZIONYCH miejsc, nie od największej liczby miejsc w ogóle.",
    "Przy podziale na szpitale kolumna z nazwą jest szersza niż w pozostałych podziałach — nazwy szpitali są długie, a słupki krótkie, więc miejsce idzie tam, gdzie jest potrzebne. Żadna nazwa nie ma być ucięta wielokropkiem.",
    "W legendzie ma być jedna pozycja „Nowa Lewica / SLD”, a nie dwie osobne w tym samym czerwonym.",
    "Najedź na szary ogon: dymek podaje samą liczbę osób z rejestru. Nie ma w nim partii ani nazwiska.",
    "W prawym górnym rogu karty jest przełącznik wykres/tabela - ma dalej działać i pokazywać te same liczby w kolumnach.",
    "Wyloguj się: przycisk przy wierszu ma mówić „Zaloguj się”, ma być czytelny (ciemnoniebieski albo ciemnobursztynowy napis, nie blady) i ma być klikalny.",
    "Kliknij go: ma zabrać na /login, a po zalogowaniu wrócić na /eksploruj/szpitale, a nie na stronę główną.",
    "Zaloguj się i kliknij „Zobacz osoby” przy dowolnym województwie: otwiera tabelę zawężoną do tego regionu, tylko nieopublikowane, od najnowszych wpisów.",
    "Zmruż oczy albo włącz skalę szarości: żaden napis na przycisku nie może zniknąć z tła.",
  ],
  link: "/eksploruj/szpitale",
  area: "public",
} satisfies QaItem;
