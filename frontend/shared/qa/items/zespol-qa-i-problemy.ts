import type { QaItem } from "../../qa";

export const order = 162;

export default {
  id: "zespol-qa-i-problemy",
  title: "Lista QA, jej problemy i zgłoszenia są w menu „Zespół”",
  description:
    "Menu „Zespół” na pasku prowadzi teraz do listy QA i do jej „Problemów”, a administratora także do zgłoszeń, które zeszły z menu „Admin”. " +
    "Na „Problemach” administrator widzi swój problem raz - jako zgłoszenie z wpisem, którego dotyczy - a nie drugi raz jako wpis pod listą zgłoszeń.",
  steps: [
    "Kliknij „Zespół” na pasku - mają tam być „QA - zmiany do sprawdzenia” i „Problemy z QA”, a z konta administratora także „Zgłoszenia”.",
    "Z konta administratora kliknij „Problemy z QA” - problem, który sam zgłosiłeś, ma być tylko linijką zgłoszenia z „QA: …”, bez listy wpisów pod spodem.",
  ],
  link: "/qa?widok=problemy",
  area: "contributor",
  fixes: ["tWVaktgCDV4CvKn5tb3B"],
} satisfies QaItem;
