import type { QaItem } from "../../qa";

export const order = 74;

export default {
  id: "poprawianie-powiazan",
  title: "Powiązanie da się poprawić bez usuwania go",
  description:
    "„Zaproponuj zmianę” na stronie osoby zmienia jej imię, partię i linki " +
    "- czyli najmniej z tego, co ta strona twierdzi. Same powiązania, a " +
    "więc stanowiska i daty, dało się dotąd tylko dodać albo usunąć: " +
    "literówka w nazwie funkcji albo rok wzięty z nieaktualnego odpisu " +
    "wymagały skasowania wpisu przez admina i wklepania go od nowa. Teraz " +
    "każdy wiersz w „Historii powiązań” ma ołówek. Zalogowany użytkownik " +
    "zgłasza poprawkę do zatwierdzenia, admin zapisuje ją od razu. Kogo " +
    "powiązanie łączy i jakiego jest rodzaju, nie zmienia się tu celowo - " +
    "przesunięcie końca to inne twierdzenie, a nie poprawka.",
  steps: [
    "Zaloguj się i wejdź na stronę dowolnej osoby z zatrudnieniem. W „Historii powiązań” przy wierszu ma być pomarańczowy ołówek.",
    "Kliknij ołówek: otwiera się okno „Popraw powiązanie” z wypełnionym stanowiskiem i datami tego wiersza, a nagłówek mówi, którego wiersza dotyczy.",
    "Sprawdź, że wpisanie daty w innym formacie niż RRRR-MM-DD blokuje zapis i pokazuje podpowiedź o formacie.",
    "Zapisz zmianę stanowiska. Jako zwykły użytkownik zobaczysz „czeka na zatwierdzenie” i wiersz na stronie się nie zmieni; jako admin zmiana wchodzi od razu.",
    "Jako admin otwórz /admin/rewizje/kolejka - propozycja zwykłego użytkownika ma tam czekać i dać się zatwierdzić; po zatwierdzeniu wiersz na stronie osoby pokazuje nowe stanowisko.",
    "Ta sama propozycja ma być widoczna na /admin/rewizje-krawedzi, z wypisaną różnicą pola.",
    "To samo powtórz w kolejce /eksploruj/nowe, w panelu bocznym /eksploruj/tabela i na stronie spółki - ołówek ma być w każdym z tych miejsc.",
    "Sprawdź, że ołówka nie widać, kiedy nie jesteś zalogowany.",
  ],
  area: "contributor",
} satisfies QaItem;
