import type { QaItem } from "../../qa";

export const order = 22;

export default {
  id: "kto-kogo-zastapil",
  title: "Kto kogo zastąpił w spółce",
  description:
    "Na stronie instytucji jest nowa sekcja „Kto kogo zastąpił”: pary " +
    "ustępujący - obejmujący stanowisko, dobrane w obrębie jednej spółki i " +
    "jednej funkcji. Zmiany z tego samego dnia zebrane są w jedno " +
    "wydarzenie, bo tak właśnie rejestr zapisuje wymianę całej rady. Na " +
    "stronie osoby to samo widać od jej strony, w sekcji „Zmiany na " +
    "stanowisku”, a w historii powiązań przy takim wpisie stoi linijka " +
    "„Wcześniej: …”.",
  steps: [
    "Wejdź na stronę dużej spółki (np. przez wyszukiwarkę wpisz „Tauron”) i zjedź do sekcji „Kto kogo zastąpił”.",
    "Znajdź kartę z kilkoma zmianami z jednej daty - ma mieć jeden nagłówek z datą i odznakę „N zmian tego samego dnia”, a nie N osobnych kart.",
    "Sprawdź opis przerwy przy strzałce: „tego samego dnia”, „po N dniach przerwy” albo „wpisy nachodzą na siebie o N dni”.",
    "Kliknij nazwisko po obu stronach strzałki - ma otwierać stronę tej osoby.",
    "Zwęź okno do szerokości telefonu - wiersz ma się przełamać w pionie, strona nie może przewijać się w bok.",
    "Wejdź na stronę osoby, która kogoś zastąpiła (np. /osoba/marzena-slomka-a8sCGsKrCC6OyVDmkOeg) - pod historią powiązań ma być sekcja „Zmiany na stanowisku” z liczbą „N z M powiązań”.",
    "Wyloguj się i otwórz tę samą stronę spółki - zmian ma być mniej, a pod sekcją ma stać informacja, ilu nie pokazujemy, bo brakuje strony jednej z osób.",
    "Zaloguj się z powrotem i odśwież tę stronę (F5, nie klikając w menu) - napis „nie pokazujemy” ma zniknąć, a brakujące osoby mają się pojawić z nazwiskami.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
