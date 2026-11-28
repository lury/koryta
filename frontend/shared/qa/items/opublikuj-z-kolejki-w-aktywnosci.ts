import type { QaItem } from "../../qa";

export const order = 244;

export default {
  id: "opublikuj-z-kolejki-w-aktywnosci",
  title: "„Opublikuj z kolejki” liczy się jako publikacja admina",
  description:
    "Osób opublikowanych przyciskiem „Opublikuj z kolejki” na /admin/oswiadczenia nie było na /aktywnosc ani w „Opublikowane osoby” na /eksploruj/statystyki. Teraz liczą się tam jako publikacja admina, który kliknął; to, co automat publikuje sam, dalej się nie liczy.",
  steps: [
    "Tylko jeśli i tak chcesz opublikować czekające osoby: kliknij „Opublikuj z kolejki” na /admin/oswiadczenia. Po kilku minutach /aktywnosc ma wpis z Twoim imieniem i tą osobą, a na /eksploruj/statystyki publikacja jest w „Opublikowane osoby”, także w Twoim wierszu rankingu.",
  ],
  link: "/admin/oswiadczenia",
  area: "admin",
} satisfies QaItem;
