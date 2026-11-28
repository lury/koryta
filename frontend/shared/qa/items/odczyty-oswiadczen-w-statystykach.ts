import type { QaItem } from "../../qa";

export const order = 292;

export default {
  id: "odczyty-oswiadczen-w-statystykach",
  title: "Skany z /oswiadczenia w statystykach, osobno od zmian",
  description:
    "Statystyki liczą teraz skany oświadczeń odczytane na /oswiadczenia, osobno od zmian w danych: mają swój kafelek, swój pasek pod wykresem dni i zakładkę „Skany” w rankingu, otwieraną jako pierwszą. Liczą się skany zalogowanych, bez pominiętych; skany bez konta dochodzą, gdy przejmie je konto. Podsumowanie miesiąca na /aktywnosc liczy działania, skany razem ze zmianami.",
  steps: [
    "Zaloguj się i odczytaj kilka wycinków na /oswiadczenia, jeden pomiń.",
    "Na /eksploruj/statystyki ranking otwiera się na „Skany”: jesteś tam z liczbą odczytów bez pominiętego. „Zmiany” to ranking ocen, propozycji, źródeł i publikacji.",
    "Pod wykresem „Co się działo w bazie” skany mają swój pasek z własną skalą. Kafelek „Odczyt oświadczenia” prowadzi na /oswiadczenia.",
    "Na /oswiadczenia/znalezione pod liczbą znalezionych osób jest link do statystyk.",
    "Bez logowania odczytaj wycinek w innej przeglądarce: liczby się nie zmieniają. Zaloguj się tam: odczyt dochodzi do dzisiejszego dnia.",
  ],
  link: "/eksploruj/statystyki",
  area: "public",
} satisfies QaItem;
