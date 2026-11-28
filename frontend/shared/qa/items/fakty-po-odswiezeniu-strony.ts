import type { QaItem } from "../../qa";

export const order = 208;

export default {
  id: "fakty-po-odswiezeniu-strony",
  title: "Kategoryzacja faktów działa także po odświeżeniu strony",
  description:
    "Odświeżona albo otwarta z linku, /ekstrakcje/kategoryzacja mówiła „Brak faktów do kategoryzacji.” pod licznikiem tysięcy faktów do oceny, a udostępniony fakt podmieniała na inny. Tak samo /ekstrakcje było puste, a „Wydobyte fakty” na stronie artykułu pokazywały 0.",
  steps: [
    "Zalogowany odśwież /ekstrakcje/kategoryzacja - ma się pokazać karta faktu.",
    "Skopiuj adres strony (z ?fact=), oceń kartę i otwórz skopiowany adres w nowej karcie - ma się pokazać ten sam fakt.",
  ],
  link: "/ekstrakcje/kategoryzacja",
  area: "contributor",
} satisfies QaItem;
