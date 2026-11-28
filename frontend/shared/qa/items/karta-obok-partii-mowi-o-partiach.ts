import type { QaItem } from "../../qa";

export const order = 108;

export default {
  id: "karta-obok-partii-mowi-o-partiach",
  title: "Karta obok wykresu partii nie odsyła już do mapy",
  description:
    "Na zakładce „Partie” mapa znika, ale karta obok cały czas prosiła o " +
    "wybranie regionu z mapy, której nie ma na ekranie. Teraz na tej " +
    "zakładce mówi, co naprawdę robi kliknięcie w partię: otwiera tabelę " +
    "przefiltrowaną po tej partii.",
  steps: [
    "Wejdź na stronę główną i przełącz eksplorator na „Partie”.",
    "Sprawdź, że karta po prawej mówi „Przejdź do tabeli” i prosi o kliknięcie partii na wykresie, a nie regionu na mapie.",
    "Wróć na „Mapa” - karta ma znowu mówić „Analizuj powiązania” i prosić o region.",
  ],
  area: "public",
} satisfies QaItem;
