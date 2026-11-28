import type { QaItem } from "../../qa";

export const order = 145;

export default {
  id: "publikacja-z-kolejki-liczy-sie",
  title: "„Zatwierdź i opublikuj” liczy się jako publikacja",
  description:
    "Publikacja z kolejki i zatwierdzenie tematu nie zostawiały wpisu o publikacji, więc licznik " +
    "„Opublikowane” na /eksploruj/statystyki ich nie widział. Teraz zostawiają, a propozycji usunięcia " +
    "kolejka nie pozwala już „opublikować”.",
  steps: [
    "W /admin/rewizje/kolejka przy propozycji usunięcia strony ma być tylko „Zatwierdź”, bez „Zatwierdź i opublikuj”.",
  ],
  link: "/admin/rewizje/kolejka",
  area: "admin",
} satisfies QaItem;
