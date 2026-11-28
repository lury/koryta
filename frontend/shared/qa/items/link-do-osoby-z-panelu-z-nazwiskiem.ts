import type { QaItem } from "../../qa";

export const order = 211;

export default {
  id: "link-do-osoby-z-panelu-z-nazwiskiem",
  title: "Strona osoby otwarta z panelu ma imię i nazwisko w adresie",
  description:
    "Nazwisko w panelu bocznym /eksploruj/tabela i /eksploruj/nowe otwierało stronę osoby pod adresem z samym identyfikatorem, a przy osobie czekającej na zatwierdzenie ten adres już zostawał. Teraz link prowadzi od razu pod adres z imieniem i nazwiskiem.",
  steps: [
    "Na /eksploruj/tabela kliknij nazwisko w wierszu, a w panelu bocznym jeszcze raz nazwisko - nowa karta ma adres /osoba/imie-nazwisko-<id>.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
