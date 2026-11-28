import type { QaItem } from "../../qa";

export const order = 8;

export default {
  id: "drawer-bottom-on-phone",
  title: "Panel boczny od dołu na telefonie",
  description:
    "Na wąskim ekranie panel osoby wysuwa się od dołu i zajmuje prawie " +
    "całą wysokość, zamiast wciskać mapę i historię zatrudnienia w pasek " +
    "przy krawędzi.",
  steps: [
    "Na telefonie (albo w przeglądarce zwęź okno poniżej 960 px) wejdź na /eksploruj/tabela i kliknij wiersz z osobą.",
    "Sprawdź, że panel wjeżdża od dołu, ma zaokrąglone górne rogi i mieści mapę oraz historię zatrudnienia bez poziomego przewijania.",
    "Zamknij go krzyżykiem i kliknięciem w przyciemnione tło nad panelem.",
    "Rozszerz okno powyżej 960 px i kliknij wiersz - panel ma wrócić do prawej krawędzi.",
    "Obróć telefon na poziomo przy otwartym panelu - ma się przeskalować do nowej wysokości, a nie zostać za wysoki.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
