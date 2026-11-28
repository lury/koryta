import type { QaItem } from "../../qa";

export const order = 245;

export default {
  id: "oswiadczenia-czerwone-zaloguj-sie",
  title: "Czerwony przycisk „Zaloguj się” na /oswiadczenia",
  description:
    "Osoba bez konta nie zauważyła prośby o zalogowanie, bo przycisk miał ten sam kolor co pasek z liczbami obok. Teraz „Zaloguj się” przy pasku „Sprawdzono” i „Znaleziono” jest czerwony.",
  steps: [
    "W oknie prywatnym zapisz jedną datę na /oswiadczenia: nad wycinkiem pojawia się pasek z czerwonym przyciskiem „Zaloguj się”. Po zalogowaniu jest tam zielony przycisk „Zobacz listę”, jak wcześniej.",
  ],
  link: "/oswiadczenia",
  area: "public",
} satisfies QaItem;
