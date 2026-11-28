import type { QaItem } from "../../qa";

export const order = 26;

export default {
  id: "tabela-starts-at-the-table",
  title: "Tabela na telefonie zaczyna się od tabeli",
  description:
    "Na wąskim ekranie filtry są zwinięte pod jeden przycisk, nagłówek jest " +
    "mniejszy, a banerek logowania nie wypycha już przycisku poza ekran. " +
    "Pierwszy wiersz tabeli był 1300 px w dół - trzy machnięcia palcem - i " +
    "jest teraz od razu pod filtrem. Na komputerze wszystko zostaje po " +
    "staremu, filtry są rozwinięte.",
  steps: [
    "Na telefonie (albo zwęż okno poniżej 960 px) wejdź na /eksploruj/tabela - tabela ma być widoczna bez przewijania albo po jednym machnięciu.",
    "Kliknij przycisk „Filtry i wyszukiwanie” - filtry mają się rozwinąć i zwinąć ponownie.",
    "Ustaw jakiś filtr, na przykład partię, i zwiń panel - na przycisku ma być „Filtry (1)”, żeby nie filtrował po cichu.",
    "Wyloguj się i sprawdź niebieski banerek: przycisk „Zaloguj się” ma być pod tekstem, w całości na ekranie.",
    "Spróbuj przewinąć stronę w bok - nie ma czego, nic nie wystaje poza ekran.",
    "Rozszerz okno powyżej 960 px - filtry mają być rozwinięte, bez przycisku do zwijania.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
