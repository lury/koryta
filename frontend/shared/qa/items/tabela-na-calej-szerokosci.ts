import type { QaItem } from "../../qa";

export const order = 107;

export default {
  id: "tabela-na-calej-szerokosci",
  title: "Tabela zajmuje całe okno, a nie lewą połowę",
  description:
    "Na szerokim monitorze /eksploruj/tabela kończyła się tam, gdzie " +
    "kończyła się treść, i stała przyklejona do lewej krawędzi, a reszta " +
    "okna była pusta. Strona prosi o pełną szerokość, ale nie brała jej. " +
    "Teraz bierze. Poniżej ok. 1120px nic się nie zmienia.",
  steps: [
    "Otwórz /eksploruj/tabela w oknie szerszym niż 1400px i sprawdź, że pasek filtrów i tabela sięgają prawej krawędzi.",
    "Zwęź okno poniżej 1120px i sprawdź, że układ wygląda jak wcześniej.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
