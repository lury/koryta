import type { QaItem } from "../../qa";

export const order = 119;

export default {
  id: "eksploruj-nowe-kroki-w-kolumnach",
  title: "„Jak to działa?” w trzech kolumnach, w kolejności kroków",
  description:
    "Rozwinięty opis był pionową listą, w której nic nie wiązało " +
    "akapitu z numerem kroku z paska nad nim. Teraz każdy krok ma " +
    "własną kolumnę - od lewej do prawej, w tej samej kolejności i z " +
    "tymi samymi numerkami co pasek.",
  steps: [
    "Zaloguj się i wejdź na /eksploruj/nowe.",
    "Jeśli opis jest schowany, kliknij „Jak to działa?”.",
    "Sprawdź, że opisy stoją obok siebie w kolejności „1 Eksploruj”, „2 Notatka”, „3 Głos” - tak jak pasek kroków nad nimi.",
    "Kliknij „Eksploruj” w wierszu tabeli i sprawdź, że numerek w pierwszej kolumnie zmienia się w zielony ptaszek, tak samo jak w pasku.",
    "Zwęź okno do szerokości telefonu - kolumny układają się jedna pod drugą.",
  ],
  link: "/eksploruj/nowe",
  area: "contributor",
} satisfies QaItem;
