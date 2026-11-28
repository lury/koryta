import type { QaItem } from "../../qa";

export const order = 246;

export default {
  id: "oswiadczenia-powod-logowania-po-dziesieciu",
  title:
    "Na telefonie /oswiadczenia po 10 odczytach sam pokazuje, po co się zalogować",
  description:
    "Na telefonie powód, by się zalogować, czeka pod „?” obok „Zaloguj się”, więc osoby bez konta go nie widziały. Teraz po 10 odczytach otwiera się sam, raz w danej przeglądarce i tylko u kogoś, kto nie otworzył go wcześniej.",
  steps: [
    "Na telefonie, w oknie prywatnym, zapisz 10 dat na /oswiadczenia: po dziesiątej pod paskiem „Sprawdzono” otwiera się „Zaloguj się, by zapisać znalezione daty”, klawiatura się chowa, a ramka staje na środku ekranu. Zamknij ją przyciskiem „?” i zapisz kolejną datę: już się nie otwiera.",
  ],
  link: "/oswiadczenia",
  area: "public",
} satisfies QaItem;
