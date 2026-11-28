import type { QaItem } from "../../qa";

export const order = 302;

export default {
  id: "profil-twoje-interakcje",
  title: "„Twoje interakcje” na /profil: propozycje zmian i głosy",
  description:
    "Karta „Twoje propozycje zmian” to teraz „Twoje interakcje”: obok propozycji są Twoje ostatnie głosy, każdy z osobą i głosem słowami skali. Chip „Głosy” zostawia same głosy.",
  steps: [
    "Zaloguj się, zagłosuj na kogoś w /eksploruj/nowe i wejdź na /profil: w „Twoje interakcje” ta osoba jest na górze, z głosem, np. „+3 Koryciarz”.",
    "Kliknij chip „Głosy”: zostają same głosy. Drugie kliknięcie wraca do wszystkiego.",
    "Kliknij wiersz z głosem: otwiera się strona tej osoby.",
  ],
  link: "/profil",
  area: "contributor",
} satisfies QaItem;
