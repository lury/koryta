import type { QaItem } from "../../qa";

export const order = 129;

export default {
  id: "fakty-tylko-dla-zalogowanych",
  title: "Wydobyte fakty widzi tylko zalogowany czytelnik",
  description:
    "Na stronie osoby sekcja „Fakty z artykułów” od początku miała pokazywać " +
    "wylogowanemu czytelnikowi samą liczbę, bez zdań - to niesprawdzone " +
    "maszynowe twierdzenia o konkretnych ludziach, więc nie powinny trafiać " +
    "do wyszukiwarek. Decydował o tym parametr zapytania, który każdy mógł " +
    "pominąć, i samo /api/extractions wydawało pełne treści komukolwiek. " +
    "Teraz decyduje serwer: bez zalogowania wraca sama liczba.",
  steps: [
    "Wyloguj się i otwórz stronę osoby, która ma dopasowane fakty.",
    "Sekcja „Fakty z artykułów” ma nadal podawać, ile ich jest, i zachęcać do zalogowania.",
    "W narzędziach deweloperskich, w zakładce Sieć, odpowiedź /api/extractions ma mieć pustą listę „facts”.",
    "Zaloguj się i odśwież - fakty mają się pojawić jak dotąd.",
  ],
  area: "public",
} satisfies QaItem;
