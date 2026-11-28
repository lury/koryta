import type { QaItem } from "../../qa";

export const order = 277;

export default {
  id: "mniej-miejsca-pod-danymi-osoby",
  title: "Mniej pustego miejsca pod danymi osoby",
  description:
    "Pod danymi osoby było za dużo pustego miejsca. Historia zaczyna się teraz wyżej, a ramka z prośbą o skany jest niższa i stoi tuż pod danymi.",
  steps: [
    "Otwórz stronę osoby: „Historia powiązań” jest bliżej daty urodzenia.",
    "Wyloguj się i otwórz stronę osoby w kilku nowych kartach: ramka „Strony jak ta powstały dzięki czytelnikom” stoi tuż pod danymi osoby.",
  ],
  area: "public",
} satisfies QaItem;
