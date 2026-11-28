import type { QaItem } from "../../qa";

export const order = 80;

export default {
  id: "rewizje-w-panelu-tym-samym-przyciskiem",
  title: "„Rewizje” w panelu bocznym wygląda jak na stronie osoby",
  description:
    "Skrót do rewizji w panelu bocznym tabeli był szarym przyciskiem z " +
    "napisem. Teraz jest tym samym kwadratowym przyciskiem z ikoną i " +
    "dymkiem, co w nagłówku strony osoby.",
  steps: [
    "Jako admin kliknij nazwisko w /eksploruj/tabela i porównaj przycisk obok „Zaproponuj zmianę” z tym na stronie osoby.",
  ],
  link: "/eksploruj/tabela",
  area: "admin",
} satisfies QaItem;
