import type { QaItem } from "../../qa";

export const order = 66;

export default {
  id: "kandydatura-bez-regionu-nie-blokuje-osoby",
  title: "Jedna kandydatura bez regionu nie przepada już razem z całą osobą",
  description:
    "Kandydatura wisi przy regionie, w którym się startowało, a PKW nie " +
    "zawsze podaje który to był - dla wyborów z lat 90. nie opublikowała " +
    "mapowania okręgów w ogóle, a region z nowszej kandydatury może po " +
    "prostu nie mieć jeszcze swojej strony. Do tej pory taka jedna " +
    "kandydatura wywracała cały upload osoby: nie zapisywały się ani jej " +
    "zatrudnienia, ani dane na jej stronie, ani pozostałe kandydatury z " +
    "tej samej paczki. Najbardziej bolało to przy uploadach, które o " +
    "wyborach w ogóle nie były - na przykład zbierających rady nadzorcze " +
    "szpitali. Teraz taka kandydatura jest pomijana i wypisywana w " +
    "odpowiedzi, a reszta osoby zapisuje się normalnie.",
  steps: [
    "Wejdź na stronę osoby, która startowała w wyborach z lat 90. (np. przez /eksploruj i filtr partii): ma mieć swoje zatrudnienia i powiązania, nawet jeśli tamtej kandydatury nie widać.",
    "Po ponownym uploadzie osób sprawdź w logach uploadera podsumowanie „candidacies were not placed” - „expected” to wybory, dla których PKW nigdy nie podała okręgu, a „no-region” to region, który nie ma jeszcze węzła.",
    "Sprawdź, że kandydatury, które da się umiejscowić, nadal się zapisują: otwórz osobę ze startem w 2024 i zobacz powiązanie z jej powiatem.",
  ],
  area: "admin",
} satisfies QaItem;
