import type { QaItem } from "../../qa";

export const order = 10;

export default {
  id: "person-notes-require-login",
  title: "Notatki o osobie tylko dla zalogowanych",
  description:
    "Na stronie osoby karta „Notatki” pokazuje się dopiero po " +
    "zalogowaniu. Notatki to niezweryfikowane twierdzenia o konkretnym " +
    "człowieku, więc nie wyświetlamy ich anonimowym czytelnikom. Strony " +
    "spółek, regionów i tematów zostają bez zmian.",
  steps: [
    "Wyloguj się i wejdź na stronę osoby, która ma notatki - karty „Notatki” ma nie być.",
    "Zaloguj się i odśwież tę samą stronę - karta ma się pojawić razem z notatkami.",
    "Wylogowany otwórz stronę spółki albo tematu - tam karta „Notatki” ma być widoczna jak dotąd.",
  ],
  area: "public",
} satisfies QaItem;
