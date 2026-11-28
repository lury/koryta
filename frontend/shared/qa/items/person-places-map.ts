import type { QaItem } from "../../qa";

export const order = 6;

export default {
  id: "person-places-map",
  title: "Mapa miejsc osoby w panelu bocznym",
  description:
    "Panel boczny osoby rysuje na mapie Polski województwa, w których " +
    "pracowała, zamiast wyliczać je tekstem.",
  steps: [
    "Wejdź na /eksploruj/tabela i kliknij wiersz z osobą.",
    "W panelu bocznym znajdź mapę i sprawdź, że podświetlone województwa zgadzają się z listą pracodawców.",
    "Kliknij osobę bez znanych miejsc pracy - mapy ma nie być zamiast pustej.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
