import type { QaItem } from "../../qa";

export const order = 176;

export default {
  id: "admin-procesy-noc",
  title: "Procesy: noc na maszynie koryta-nightly",
  description:
    "Na /admin/procesy jest nowy wiersz „Noc na maszynie koryta-nightly”: jedna maszyna co noc, po kopii bazy z 04:00, uzupełnia lustro, pobiera KRS, przelicza potoki, sprawdza bazę i wysyła do 100 osób, a każdy krok widać jako etap.",
  steps: [
    "Otwórz /admin/procesy i rozwiń „Noc na maszynie koryta-nightly” - ma pokazać harmonogram „codziennie o 04:30 czasu warszawskiego”, polecenie koryta_nightly i zadania do wdrożenia.",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
