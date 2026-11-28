import type { QaItem } from "../../qa";

export const order = 144;

export default {
  id: "poziomy-trudnosci-kolejki",
  title: "Kolejka ma trzy poziomy trudności, z liczbą osób do zrobienia",
  description:
    "Kolejka układała 9 tys. osób według tego, jak bardzo są ciekawe, i nic " +
    "nie mówiła o tym, ile pracy kosztuje sprawdzenie jednej z nich - a to " +
    "dwie różne rzeczy. Teraz na stronie pomocy są trzy poziomy: osoby z " +
    "biogramem na Wikipedii obok wpisu w rejestrze, osoby ze świeżą wygraną " +
    "w wyborach (jest oświadczenie majątkowe do porównania) i osoby z " +
    "faktami wyciągniętymi z artykułów. Przy każdym piszemy, ile osób " +
    "zostało, i pokazujemy kogoś, kto już został sprawdzony.",
  steps: [
    "Wejdź na /pomoc i zjedź do sekcji „Sprawdzaj razem z nami”.",
    "Pod czterema kaflami ma być blok „Od czego zacząć: trzy poziomy trudności”.",
    "Każdy kafel ma mówić, na czym polega robota, czego do niej trzeba, i ile osób zostało (liczba może się nie pokazać, jeśli statystyki jeszcze się nie przeliczyły - to nie błąd).",
    "Kliknij kafel „1.” - kolejka ma się otworzyć z ustawionym filtrem „Poziom trudności” i opisem „Tylko poziom 1”.",
    "W kolejce zmień poziom na 3 - lista ma się przeładować, a w adresie ma się pojawić „tier=3”.",
    "Wyczyść filtr poziomu - kolejka ma wrócić do domyślnej, z minimalną sumą ocen 3.",
    "Wróć na /pomoc i kliknij nazwisko w bloku „Tak wygląda strona, którą ktoś już sprawdził” - ma otworzyć stronę tej osoby.",
  ],
  link: "/pomoc",
  area: "contributor",
} satisfies QaItem;
