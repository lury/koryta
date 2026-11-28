import type { QaItem } from "../../qa";

export const order = 269;

export default {
  id: "prosba-o-odczyt-skanow-na-stronie-osoby",
  title: "Na stronie osoby prośba o odczytanie kilku skanów oświadczeń",
  description:
    "Nad „Historią powiązań” połowa niezalogowanych czytelników widzi, ile osób strona opublikowała automatycznie w ostatnich 30 dniach, i przycisk „Odczytaj skany” do /oswiadczenia. Druga połowa jej nie widzi, żeby porównać, czy ramka nie zniechęca do reszty strony.",
  steps: [
    "Wyloguj się i otwórz stronę dowolnej osoby w kilku nowych kartach: mniej więcej w co drugiej nad „Historią powiązań” jest ramka z liczbą, „Strony jak ta powstały dzięki czytelnikom” i przyciskiem „Odczytaj skany”, w pozostałych jej nie ma. W jednej karcie zostaje to samo.",
    "Kliknij „Odczytaj skany”: otwiera się /oswiadczenia.",
    "Zaloguj się: ramki nie ma.",
  ],
  area: "public",
} satisfies QaItem;
