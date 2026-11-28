import type { QaItem } from "../../qa";

export const order = 303;

export default {
  id: "kolejka-imie-prowadzi-do-strony-osoby",
  title: "Imię w kolejce prowadzi na stronę osoby",
  description:
    "W /eksploruj/nowe imię i nazwisko w wierszu tabeli jest linkiem do strony osoby. Po powrocie przyciskiem Wstecz kolejka pokazuje tę samą osobę.",
  steps: [
    "Zaloguj się, otwórz /eksploruj/nowe i kliknij imię i nazwisko w wierszu tabeli: otwiera się strona tej osoby.",
    "Kliknij Wstecz w przeglądarce: w kolejce jest ta sama osoba.",
  ],
  link: "/eksploruj/nowe",
  area: "contributor",
  fixes: ["INTrv78UrTpxi1P8tC2R"],
} satisfies QaItem;
