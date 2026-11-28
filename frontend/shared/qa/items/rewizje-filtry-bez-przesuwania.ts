import type { QaItem } from "../../qa";

export const order = 179;

export default {
  id: "rewizje-filtry-bez-przesuwania",
  title: "Rewizje: filtr nie przesuwa strony pod lewą krawędź",
  description:
    "Zmiana „Rodzaju” czy innego filtra na /admin/rewizje przesuwała całą stronę pod lewą krawędź okna, bo pod listami było tyle numerów stron, ile stron - pod wpisami 1828. Teraz numerów jest tyle, ile się mieści w wierszu.",
  steps: [
    "Na /admin/rewizje zmień „Rodzaj” na „Z pipeline'u” - strona ma zostać na środku, z marginesem po lewej, a pod każdą listą ma być jeden rząd numerów stron.",
  ],
  link: "/admin/rewizje#kolejka",
  area: "admin",
} satisfies QaItem;
