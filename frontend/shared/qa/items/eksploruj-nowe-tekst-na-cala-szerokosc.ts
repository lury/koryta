import type { QaItem } from "../../qa";

export const order = 120;

export default {
  id: "eksploruj-nowe-tekst-na-cala-szerokosc",
  title: "„Eksploruj nowe”: wstęp na całą szerokość strony",
  description:
    "Akapit tłumaczący, po co jest kolejka, kończył się w połowie " +
    "ekranu, choć karty nad nim i pod nim sięgały obu krawędzi - " +
    "wyglądał jak ucięty. Na szerokim ekranie stoi teraz w dwóch " +
    "kolumnach, więc wypełnia stronę, a pojedyncza linijka nie jest " +
    "dłuższa niż wcześniej.",
  steps: [
    "Zaloguj się i wejdź na /eksploruj/nowe w oknie szerszym niż 960 px.",
    "Sprawdź, że akapit pod nagłówkiem „Eksploruj nowe osoby” sięga tej samej prawej krawędzi co karta filtrów pod nim i stoi w dwóch kolumnach.",
    "Zwęź okno poniżej 960 px - tekst wraca do jednej kolumny na całą szerokość.",
  ],
  link: "/eksploruj/nowe",
  area: "contributor",
} satisfies QaItem;
