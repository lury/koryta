import type { QaItem } from "../../qa";

export const order = 135;

export default {
  id: "potwierdzenie-propozycji-na-calej-szerokosci",
  title: "Potwierdzenie zaproponowanej zmiany mieści się w karcie spółki",
  description:
    "Po wysłaniu „Zaproponuj zmianę” potwierdzenie wciskało się w resztkę " +
    "miejsca obok przycisków - wychodził z tego pasek na kilka liter " +
    "szerokości, łamiący „Zaproponowano zmianę” w pionie i rozpychający " +
    "kartę instytucji. Teraz staje w osobnym wierszu, na całej szerokości " +
    "karty. Treść bez zmian.",
  steps: [
    "Zaloguj się, wejdź na stronę dowolnej instytucji i wyślij coś przez „Zaproponuj zmianę”.",
    "Niebieskie potwierdzenie ma stać pod przyciskami, w jednej linii, a nagłówek karty ma zostać tam, gdzie był.",
  ],
  area: "contributor",
} satisfies QaItem;
