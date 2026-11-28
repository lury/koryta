import type { QaItem } from "../../qa";

export const order = 16;

export default {
  id: "qa-link-in-admin-panel",
  title: "Lista QA schodzi z paska na panel",
  description:
    "Pasek u góry nie nosi już przycisku „QA” ani licznika, który przy " +
    "każdym zgłoszonym problemie robił się czerwony na każdej podstronie. " +
    "Wejście do listy jest teraz w panelu administracyjnym, a sama lista " +
    "zostaje otwarta dla każdego zalogowanego.",
  steps: [
    "Zaloguj się i przejdź po kilku podstronach - w pasku pod górnym menu nie ma już przycisku „QA” ani liczby przy nim.",
    "Wejdź na /admin i znajdź kafelek „QA” wśród podstron - ma prowadzić na /qa.",
    "Wpisz /qa ręcznie w adres jako zwykły (nieadministrujący) użytkownik - strona ma się otworzyć normalnie.",
  ],
  link: "/admin",
  area: "contributor",
} satisfies QaItem;
