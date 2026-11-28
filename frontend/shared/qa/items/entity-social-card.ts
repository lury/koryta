import type { QaItem } from "../../qa";

export const order = 306;

export default {
  id: "entity-social-card",
  title: "Linki do osób i instytucji mają własną miniaturę",
  description:
    "Każdy udostępniony link pokazywał ten sam baner Koryta.pl, więc " +
    "podlinkowana osoba wyglądała tak samo jak strona główna. Teraz link do " +
    "osoby albo instytucji niesie jej nazwę, partię lub status właściciela, " +
    "jeden fakt i do trzech liczb.",
  steps: [
    'Wejdź na stronę dowolnej osoby, otwórz źródło strony i sprawdź, że meta property="og:image" wskazuje na /_og/, a nie na /social-card.png.',
    "Wklej ten sam adres na Facebooku albo w Slacku (bez wysyłania) - podgląd ma pokazać nazwisko, a nie baner serwisu.",
    "To samo dla strony instytucji: miniatura ma mieć sektor u góry i liczbę osób w organach na zielonym pasku.",
    "Wejdź na stronę szkicu (niezatwierdzoną) - tam og:image ma dalej wskazywać /social-card.png.",
  ],
  area: "public",
} satisfies QaItem;
