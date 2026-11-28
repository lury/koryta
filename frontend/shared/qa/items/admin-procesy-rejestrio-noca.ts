import type { QaItem } from "../../qa";

export const order = 178;

export default {
  id: "admin-procesy-rejestrio-noca",
  title: "Procesy: rejestr.io co noc, z dziennym limitem",
  description:
    "Zapytania do rejestr.io są teraz krokiem nocy: kupuje się tylko to, czego nie dały bezpłatne źródła, najwyżej 50 zapytań dziennie.",
  steps: [
    "Otwórz /admin/procesy i rozwiń „Zapytania do rejestr.io (płatne)” - ma pokazać harmonogram „codziennie o 04:30”, polecenie z --max-calls 50 i dzienny limit w uwagach.",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
