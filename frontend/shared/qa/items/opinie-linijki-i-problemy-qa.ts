import type { QaItem } from "../../qa";

export const order = 158;

export default {
  id: "opinie-linijki-i-problemy-qa",
  title: "Zgłoszenia to linijki, a „Problemy” na /qa zbierają zgłoszenia z QA",
  description:
    "Na /admin/opinie każde zgłoszenie to linijka, która rozwija się po kliknięciu, a chipy „Wszystkie”, „Zgłoszenia” i „Z QA” zawężają listę. " +
    "Zakładka „Problemy” na /qa pokazuje administratorom wszystkie otwarte zgłoszenia z QA, które można rozpatrzyć na miejscu.",
  steps: [
    "Na /admin/opinie kliknij chip „Z QA” i rozwiń zgłoszenie - ma pokazać rodzaj, datę, autora, status i notatkę.",
    "Na /qa otwórz „Problemy” i zmień status któregoś zgłoszenia - ta sama zmiana ma być widoczna na /admin/opinie.",
  ],
  link: "/admin/opinie",
  area: "admin",
} satisfies QaItem;
