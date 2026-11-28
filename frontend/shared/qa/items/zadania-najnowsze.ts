import type { QaItem } from "../../qa";

export const order = 165;

export default {
  id: "zadania-najnowsze",
  title: "Zadania: najnowsze na górze listy",
  description:
    "Listy na /admin/zadania można ułożyć od najnowszych, żeby nic świeżo dodanego nie utonęło w starszych. Stronę widzi tylko właściciel serwisu.",
  steps: [
    "Na /admin/zadania wybierz „Najnowsze” - ostatnio dodane zadania mają być na górze każdej listy, z „dzisiaj”, „wczoraj” albo „N dni temu” na końcu wiersza.",
  ],
  link: "/admin/zadania?kolejnosc=najnowsze",
  area: "admin",
} satisfies QaItem;
