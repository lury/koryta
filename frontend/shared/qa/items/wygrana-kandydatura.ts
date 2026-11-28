import type { QaItem } from "../../qa";

export const order = 143;

export default {
  id: "wygrana-kandydatura",
  title: "Widać, którą kandydaturę osoba wygrała",
  description:
    "PKW podaje wynik przy kandydaturze, a serwis go do tej pory gubił - " +
    "wynik miały 2 z 14 518 zapisanych kandydatur, więc żadna strona nie " +
    "mogła powiedzieć, że ktokolwiek wygrał. Teraz wygrane mają chip " +
    "„Wybrany”. Przegranych nie oznaczamy: PKW nie podała wyniku dla 70% " +
    "swojego rejestru, a puste pole w formularzu wygląda tak samo jak " +
    "przegrana, więc chip „Przegrał” byłby zarzutem wobec konkretnej osoby " +
    "postawionym na podstawie milczenia rejestru.",
  steps: [
    "Wejdź na stronę osoby, która startowała w wyborach samorządowych 2010 lub 2024 albo do sejmu w 2011, 2019 lub 2023 - tylko te roczniki mają wynik w komplecie.",
    "W historii powiązań, przy wygranej kandydaturze, ma być zielony chip „Wybrany”.",
    "Sprawdź kandydaturę z wyborów samorządowych 2014 - tam PKW wyniku nie podała, więc chipa ma nie być (brak chipa to nie przegrana).",
  ],
  area: "public",
} satisfies QaItem;
