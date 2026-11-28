import type { QaItem } from "../../qa";

export const order = 33;

export default {
  id: "karta-firmy-prowadzi-na-strone-spolki",
  title: "Karta firmy na Eksploruj prowadzi na stronę spółki",
  description:
    "Na /eksploruj/tabela zawężonej do firmy nazwa w karcie z jej danymi jest " +
    "teraz linkiem na stronę tej spółki. Gdy wybranych firm jest kilka i " +
    "karty się zwijają, ten sam link mają chipy z nazwami. Wcześniej z " +
    "tabeli nie dało się przejść na stronę spółki - trzeba było znaleźć ją " +
    "wyszukiwarką.",
  steps: [
    "Wejdź na /eksploruj/tabela?place=ZBcdQ9tUxVyv0o1mnpLH i przewiń pod tabelę - ma tam być karta z nazwą spółki (od czasu paska zapytania karta stoi pod tabelą, a nie nad nią).",
    "Kliknij nazwę w karcie: ma otworzyć /instytucja/… tej spółki.",
    "Wróć i wybierz trzy firmy albo więcej („Filtry” → „Więcej filtrów” → „Instytucje”) - karty mają się zwinąć do chipów z nazwami. Kliknięcie chipa ma prowadzić na stronę tej spółki.",
    "Rozwiń („Pokaż szczegóły”) - nazwa na każdej karcie ma być linkiem tak samo jak przy jednej firmie.",
    "Wejdź na samą stronę spółki (/instytucja/…): tam ta sama karta jest nagłówkiem strony, więc nazwa ma zostać zwykłym tekstem, bez linku do samej siebie.",
  ],
  link: "/eksploruj/tabela?place=ZBcdQ9tUxVyv0o1mnpLH",
  area: "public",
} satisfies QaItem;
