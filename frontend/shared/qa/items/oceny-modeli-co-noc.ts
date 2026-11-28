import type { QaItem } from "../../qa";

export const order = 177;

export default {
  id: "oceny-modeli-co-noc",
  title: "Oceny modeli co noc, także dla nowych stron",
  description:
    "Noc na maszynie koryta-nightly wysyła po imporcie osób oceny modeli, także dla stron, które ten import właśnie utworzył - nowa osoba trafia do kolejki /eksploruj/nowe tego samego ranka, a nie dopiero po następnej kopii bazy.",
  steps: [
    "Rano otwórz /admin/procesy i rozwiń „Oceny modeli” - ostatnie uruchomienie ma być z nocy, z licznikami „zapisanych”, „wycofanych” i „nowych stron z oceną”.",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
