import type { QaItem } from "../../qa";

export const order = 31;

export default {
  id: "tabela-firmy-wszystkich-wierszy",
  title: "Kolumna „Firmy” znowu wypełniona w całej tabeli",
  description:
    "W tabeli na Eksploruj kolumna „Firmy” była pusta we wszystkich " +
    "wierszach poza pierwszym - mimo że dana osoba miała w bazie " +
    "zatrudnienie. Zapytanie o powiązania całej strony wyników traktowało " +
    "pierwszy wiersz jako temat, a pozostałe dziewięć jako jego sąsiadów, " +
    "więc ich własne firmy nigdy nie wracały z serwera. Teraz każdy wiersz " +
    "jest pytany o swoje powiązania osobno. Przy okazji działa znowu " +
    "przycisk „Rozwiń” na grafie przy domyślnej głębokości 1.",
  steps: [
    "Wejdź na /eksploruj/tabela?sortBy=latestEmploymentStart&sortDesc=true - kolumna „Firmy” ma być wypełniona w każdym wierszu, w którym osoba ma zatrudnienie, a nie tylko w pierwszym.",
    "Sprawdź konkretnie Marzenę Słomkę (trzeci wiersz przy tym sortowaniu) - ma pokazywać firmę, a nie pustą komórkę.",
    "Kliknij nazwisko z dalszego wiersza: firmy w szufladzie i w kolumnie mają się zgadzać.",
    "Przejdź na drugą stronę wyników i na inne sortowanie - to samo ma być prawdą tam.",
    "Wejdź na stronę dowolnej osoby, na grafie kliknij sąsiedni węzeł i wybierz „Rozwiń” przy suwaku głębokości ustawionym na 1 - mają dojść jego powiązania, narysowane bledszym, zewnętrznym pierścieniem.",
  ],
  link: "/eksploruj/tabela?sortBy=latestEmploymentStart&sortDesc=true",
  area: "public",
} satisfies QaItem;
