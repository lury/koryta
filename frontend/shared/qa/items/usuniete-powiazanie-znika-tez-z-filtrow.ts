import type { QaItem } from "../../qa";

export const order = 49;

export default {
  id: "usuniete-powiazanie-znika-tez-z-filtrow",
  title: "Usunięte powiązanie znika też z filtrów i ze statystyk",
  description:
    "Usunięcie powiązania przez admina jest „miękkie” - dokument zostaje, " +
    "tylko z oznaczeniem, żeby dało się odtworzyć kto i dlaczego je zdjął. " +
    "Grafy i strony podmiotów czytały to oznaczenie, ale trzy miejsca nie: " +
    "filtr „Siedziba spółki”, przeliczanie statystyk i sprawdzanie " +
    "siedziby przy imporcie z KRS. Skutek był taki, że usunięta siedziba " +
    "dalej trzymała spółkę w regionie, w którym nikt jej nie umieszczał, i " +
    "nie dało się tego cofnąć - a import, widząc „konflikt siedzib”, " +
    "odmawiał wpisania tej prawidłowej. Teraz usunięte powiązanie nie " +
    "liczy się nigdzie.",
  steps: [
    "Wejdź na stronę spółki i sprawdź, w jakim regionie ma siedzibę.",
    "Usuń powiązanie „siedziba” przyciskiem usuwania powiązania (jako admin), podając powód.",
    "Wejdź na /eksploruj/tabela?latest=true, otwórz „Filtry”, rozwiń „Więcej filtrów”, ustaw „Siedziba spółki” na ten region i sprawdź, że pracownicy tej spółki już się nie pokazują.",
    "Sprawdź, że powiązanie nadal jest widoczne w historii rewizji tej krawędzi razem z powodem usunięcia - usuwanie nie kasuje historii.",
  ],
  link: "/eksploruj/tabela",
  area: "admin",
} satisfies QaItem;
