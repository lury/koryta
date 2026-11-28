import type { QaItem } from "../../qa";

export const order = 184;

export default {
  id: "admin-procesy-noc-wstrzymana",
  title: "Procesy: noc, która coś wstrzymała, wymaga uwagi",
  description:
    "Noc, która wstrzymała wysyłkę osób - bo nowy test nie przechodzi albo nie ma dzisiejszej kopii bazy - była tylko „Niedokończona”, jak zwykłe zaległości, i nie trafiała do procesów wymagających uwagi. Teraz jest „Wstrzymane kroki” i mówi, który krok wstrzymała i dlaczego.",
  steps: [
    "Po nocy, która coś wstrzymała, otwórz /admin/procesy - „Noc na maszynie koryta-nightly” ma być w bloku „wymaga uwagi”, z wierszem otwartym i powodem w rodzaju „people: held - wstrzymane: nowe błędy testów: …”.",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
