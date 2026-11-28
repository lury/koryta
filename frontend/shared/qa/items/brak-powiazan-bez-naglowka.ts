import type { QaItem } from "../../qa";

export const order = 131;

export default {
  id: "brak-powiazan-bez-naglowka",
  title: "Pusta „Historia powiązań” znika zamiast stać nad niczym",
  description:
    "Nagłówek „Historia powiązań” rysował się zawsze, więc strona bez ani " +
    "jednego powiązania pokazywała sam nagłówek i pustkę pod nim. Teraz " +
    "sekcja po prostu się nie pojawia; zalogowany redaktor widzi ją nadal, " +
    "bo to w niej stoi przycisk „Dodaj”.",
  steps: [
    "Wyloguj się i otwórz stronę encji, która nie ma żadnych powiązań.",
    "Nie ma już nagłówka „Historia powiązań”.",
    "Zaloguj się i odśwież - nagłówek wraca razem z przyciskiem „Dodaj”.",
  ],
  area: "public",
} satisfies QaItem;
