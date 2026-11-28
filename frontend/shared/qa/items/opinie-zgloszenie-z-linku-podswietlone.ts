import type { QaItem } from "../../qa";

export const order = 159;

export default {
  id: "opinie-zgloszenie-z-linku-podswietlone",
  title: "Zgłoszenie, do którego prowadzi link, zostaje podświetlone",
  description:
    "Link do zgłoszenia rozwijał je, ale obwódka znikała po dwóch sekundach. Teraz zgłoszenie ma zielone tło i obwódkę tak długo, jak adres na nie wskazuje.",
  steps: [
    "Na /admin/opinie rozwiń zgłoszenie i kliknij jego datę (albo „Otwórz w panelu” na Slacku) - ma być rozwinięte i podświetlone także po przewinięciu strony i powrocie.",
  ],
  link: "/admin/opinie",
  area: "admin",
} satisfies QaItem;
