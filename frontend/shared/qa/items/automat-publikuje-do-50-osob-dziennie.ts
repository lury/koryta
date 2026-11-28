import type { QaItem } from "../../qa";

export const order = 249;

export default {
  id: "automat-publikuje-do-50-osob-dziennie",
  title: "Automat publikuje do 50 osób dziennie",
  description:
    "Publikowanie automatyczne z oświadczeń majątkowych było wyłączone. Teraz serwis sam publikuje do 50 szkiców dziennie, gdy odczytana data urodzenia zgadza się z datą na stronie osoby.",
  steps: [
    "Na /admin/oswiadczenia „Dziś” pokazuje, ilu osób automat opublikował dziś, „z 50”, z paskiem zamiast kratek.",
  ],
  link: "/admin/oswiadczenia",
  area: "admin",
} satisfies QaItem;
