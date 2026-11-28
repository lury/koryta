import type { QaItem } from "../../qa";

export const order = 262;

export default {
  id: "noc-wysyla-zmiany-firm",
  title: "Noc sama wysyła zmiany firm, które strona już ma",
  description:
    "Nowy publiczny właściciel albo fundator, branże czy forma prawna szły dotąd na stronę firmy tylko ręcznie. Teraz wysyła je noc, po osobach. Zmian nazw i firm, które stałyby się prywatne, nie wysyła.",
  steps: [
    "Rano po nocy otwórz /admin/procesy i rozwiń „Import firm”: drugie uruchomienie z nocy ma liczniki „w paczce” i „zaktualizowanych”, a wstrzymane firmy i nazwy w ostrzeżeniach.",
    "Otwórz stronę Fundacji Agencji Rozwoju Przemysłu: we „Właścicielach” jest Agencja Rozwoju Przemysłu z dopiskiem „Fundator”.",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
