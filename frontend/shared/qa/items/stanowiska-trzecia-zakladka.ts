import type { QaItem } from "../../qa";

export const order = 295;

export default {
  id: "stanowiska-trzecia-zakladka",
  title: "„Stanowiska” jako trzecia zakładka na głównej",
  description:
    "Wykres stanowisk jest ostatnią zakładką i strona główna nie otwiera się już na nim. Połowa czytelników widzi na start mapę, połowa oświadczenia.",
  steps: [
    "Otwórz / w oknie prywatnym: zakładki to „Mapa”, „Oświadczenia”, „Stanowiska”, a otwarta jest mapa albo oświadczenia.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
