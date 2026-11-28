import type { QaItem } from "../../qa";

export const order = 132;

export default {
  id: "opisy-powiazan-naprawde-sie-rysuja",
  title: "„Opisy powiązań” w grafie wreszcie coś rysują",
  description:
    "Przełącznik „Opisy powiązań” działał od strony przycisku, ale podpisy " +
    "nigdy się nie pojawiały: biblioteka grafu decyduje raz, przy pierwszym " +
    "rysowaniu, czy w ogóle zakłada warstwę podpisów - a przy wyłączonym " +
    "przełączniku jej nie zakładała i późniejsze włączenie nie miało już " +
    "czego pokazać. Teraz warstwa jest zawsze, a wyłączony przełącznik po " +
    "prostu nic w niej nie rysuje.",
  steps: [
    "Otwórz stronę osoby z grafem, np. /osoba/boguslaw-nadolnik-aiEctjVbbp5CngABStah.",
    "Kliknij „Opisy powiązań”.",
    "Nad liniami mają pojawić się podpisy, np. „Zatrudniony” albo „Startował w wyborach”.",
    "Kliknij „Ukryj opisy” - podpisy znikają, a graf się nie przeładowuje.",
  ],
  link: "/osoba/boguslaw-nadolnik-aiEctjVbbp5CngABStah",
  area: "public",
} satisfies QaItem;
