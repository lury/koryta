import type { QaItem } from "../../qa";

export const order = 75;

export default {
  id: "notatki-spolki-na-calej-szerokosci",
  title: "Notatki spółki otwierają się pod kartą, nie obok niej",
  description:
    "Przycisk „Notatki” na karcie spółki dzielił ją dotąd na dwie kolumny: " +
    "szczegóły po lewej, notatki po prawej. Na /eksploruj/tabela, gdzie " +
    "karta zbiera wszystkie wybrane filtrem spółki, taka połówka była za " +
    "wąska, żeby przeczytać w niej wklejony cytat. Notatki otwierają się " +
    "teraz pod szczegółami, na całej szerokości karty. W kolejce " +
    "/eksploruj/nowe, gdzie sekcja notatek i tak zajmuje pół ekranu, " +
    "kolejne wpisy przestały się dodatkowo dzielić na dwie kolumny.",
  steps: [
    "Zaloguj się i wejdź na /eksploruj/tabela z wybraną spółką (np. przez filtr firmy) - nad tabelą stoi karta „Wybrane firmy”.",
    "Rozwiń szczegóły spółki i kliknij „Notatki”: sekcja ma się pojawić pod danymi spółki i zajmować całą szerokość karty, a nie stanąć obok nich.",
    "Dodaj dwie notatki - mają leżeć jedna pod drugą, każda na całą szerokość.",
    "To samo sprawdź na stronie spółki (/instytucja/...) - tam karta zachowuje się tak samo.",
    "Na /eksploruj/nowe otwórz kolejkę: notatki po prawej stronie mają iść w jednej kolumnie, po jednym wpisie w wierszu.",
  ],
  link: "/eksploruj/tabela",
  area: "contributor",
} satisfies QaItem;
