import type { QaItem } from "../../qa";

export const order = 197;

export default {
  id: "zadania-priorytet-i-cele",
  title: "Zadania: pilne i ważne, także całe cele",
  description:
    "Zadanie albo cel można oznaczyć jako pilne lub ważne, a listy idą od najpilniejszych. Priorytet przechodzi na wszystko, na co zadanie czeka - ważny cel podnosi każde zadanie, które do niego prowadzi. Stronę widzi tylko właściciel serwisu.",
  steps: [
    "Na /admin/zadania otwórz cel i w „Priorytet” kliknij „Ważne” - zadania, które do niego prowadzą, mają mieć etykietę „do ważnego celu” i wejść na górę swoich list.",
    "Kliknij filtr „Pilne” - mają zostać tylko pilne zadania i to, na co czekają.",
  ],
  link: "/admin/zadania",
  area: "admin",
} satisfies QaItem;
