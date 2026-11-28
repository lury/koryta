import type { QaItem } from "../../qa";

export const order = 104;

export default {
  id: "graf-opisy-powiazan",
  title: "Graf może podpisać każdą linię",
  description:
    "Kolory i kreski mówiły, jakiego rodzaju jest powiązanie, ale trzeba " +
    "było znać legendę. Przycisk „Opisy powiązań” na pasku nad grafem " +
    "wypisuje to wprost przy każdej linii - stanowisko, jeśli ktoś je " +
    "wpisał, a jak nie, to rodzaj powiązania. Domyślnie wyłączone, bo przy " +
    "dwóch krokach podpisów jest więcej niż miejsca; wybór trzyma się przy " +
    "przechodzeniu między stronami.",
  steps: [
    "Wejdź na stronę osoby z grafem i sprawdź, że linie są bez podpisów.",
    "Kliknij „Opisy powiązań” na pasku nad grafem - przy liniach mają pojawić się napisy typu „pracuje” czy „kandydował”.",
    "Przejdź na stronę innej osoby: podpisy mają zostać włączone, a przycisk ma mówić „Ukryj opisy”.",
  ],
  area: "public",
} satisfies QaItem;
