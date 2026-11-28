import type { QaItem } from "../../qa";

export const order = 291;

export default {
  id: "strona-eksploruj",
  title: "Strona /eksploruj ze wszystkimi sposobami przeglądania",
  description:
    "/eksploruj zbiera w kartach tabelę, nowe osoby, okrągły staż, rady szpitali, statystyki, wykresy, tematy i źródła. W stopce zastąpiła „Rady szpitali” i „Okrągły staż”, a stopka ma teraz kolumny „Na stronie” i „O projekcie”.",
  steps: [
    "W stopce, pod „Na stronie”, kliknij „Eksploruj”. „O nas”, „Kontakt” i „Działaj z nami” są w kolumnie obok, nad „Informacjami prawnymi”.",
    "Kliknij kilka kart: każda prowadzi na swoją stronę, a liczby na kartach są pogrupowane („10 348 osób”).",
  ],
  link: "/eksploruj",
  area: "public",
} satisfies QaItem;
