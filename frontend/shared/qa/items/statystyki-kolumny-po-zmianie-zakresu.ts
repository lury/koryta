import type { QaItem } from "../../qa";

export const order = 231;

export default {
  id: "statystyki-kolumny-po-zmianie-zakresu",
  title: "„Co się działo w bazie” przy 7 dniach i po zmianie zakresu",
  description:
    "Wykres na /eksploruj/statystyki rysował przy 7 dniach kolumny na prawie całą szerokość dnia, a po zmianie zakresu wybierał daty do podpisania według starego zakresu. Teraz kolumna ma najwyżej 48 pikseli, a podpisy idą za zakresem.",
  steps: [
    "Wejdź na /eksploruj/statystyki i przy „Kto tworzy koryta.pl” wybierz „7 dni”. Kolumny wykresu „Co się działo w bazie” mają być wąskie, z odstępami.",
    "Wybierz „90 dni”, potem „30 dni”. Za każdym razem daty pod wykresem mają pasować do kolumn, a ostatnia data nie może być ucięta.",
  ],
  link: "/eksploruj/statystyki",
  area: "public",
} satisfies QaItem;
