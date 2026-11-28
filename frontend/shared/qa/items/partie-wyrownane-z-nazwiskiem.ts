import type { QaItem } from "../../qa";

export const order = 105;

export default {
  id: "partie-wyrownane-z-nazwiskiem",
  title: "Chipy partii wyrównane z nazwiskiem i rozsunięte",
  description:
    "Chip partii przy nazwisku siedział kilka pikseli niżej niż samo " +
    "nazwisko, bo wiersz nie miał wyrównania do środka. Dodatkowo dwie " +
    "partie w tym samym kolorze - Nowa Lewica i SLD to ta sama partia po " +
    "zmianie nazwy - stykały się i czytały jak jeden blok. Teraz wiersz " +
    "jest wyrównany do środka, a między chipami jest odstęp.",
  steps: [
    "Wejdź na /osoba/rafal-trzaskowski-8rg6MrDfdiRR7YaAvE5O i sprawdź, że chip partii stoi w jednej linii ze środkiem nazwiska.",
    "Otwórz stronę osoby z dwiema partiami w tym samym kolorze (np. Nowa Lewica i SLD) i sprawdź, że chipy są rozsunięte, a nie sklejone.",
  ],
  area: "public",
} satisfies QaItem;
