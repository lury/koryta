import type { QaItem } from "../../qa";

export const order = 263;

export default {
  id: "link-do-zakladki-na-glownej",
  title: "Link do zakładki na głównej",
  description:
    "Adres strony głównej mówi, która zakładka jest otwarta. Link otwiera tę zakładkę zamiast losowej.",
  steps: [
    "Otwórz /?widok=stanowiska: zawsze otwiera się „Stanowiska”. Tak samo /?widok=oswiadczenia i /?widok=mapa.",
    "Kliknij zakładkę na głównej: adres kończy się na ?widok= z jej nazwą.",
  ],
  link: "/?widok=stanowiska",
  area: "public",
} satisfies QaItem;
