import type { QaItem } from "../../qa";

export const order = 136;

export default {
  id: "partia-osoby-w-historii-powiazan",
  title: "Partia osoby, z którą ktoś jest powiązany",
  description:
    "„Historia powiązań” była ostatnim miejscem na stronie, w którym " +
    "człowiek był wymieniony bez partii - na stronie osoby wiersz " +
    "„Powiązanie z” podawał samo imię i nazwisko, a na stronie instytucji " +
    "cały skład, choć „Obecny skład” tuż wyżej partie pokazuje. Teraz " +
    "plakietka z partią jest w obu miejscach.",
  steps: [
    "Wejdź na stronę osoby, która ma powiązanie z inną osobą - w sekcji „Historia powiązań” obok nazwiska ma być kolorowa plakietka z partią.",
    "Wejdź na stronę instytucji - w „Historii powiązań” partie mają się zgadzać z tymi w „Obecnym składzie” wyżej.",
    "Wiersz prowadzący do spółki albo do osoby bez partii wygląda jak dotąd.",
  ],
  area: "public",
} satisfies QaItem;
