import type { QaItem } from "../../qa";

export const order = 309;

export default {
  id: "karta-osoby-jak-strona",
  title: "Miniatura linku do osoby wygląda jak jej strona",
  description:
    "Podgląd linku do osoby ma imię i nazwisko z partią i do trzech wierszy „Historia powiązań”, najpierw instytucje publiczne.",
  steps: [
    "Wklej na Facebooku albo w Slacku (bez wysyłania) link do osoby z partią i stanowiskiem w instytucji publicznej: podgląd ma chip partii i wiersze jak na stronie.",
    "Paski w wierszach mają wspólną oś: od najwcześniejszego pokazanego stanowiska do dziś.",
  ],
  area: "public",
} satisfies QaItem;
