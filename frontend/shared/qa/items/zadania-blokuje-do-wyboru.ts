import type { QaItem } from "../../qa";

export const order = 169;

export default {
  id: "zadania-blokuje-do-wyboru",
  title: "Zadania: „Blokuje” do wybrania, tak jak „Czeka na”",
  description:
    "W szczegółach zadania można teraz wskazać nie tylko, na co ono czeka, ale też co ma czekać na nie. Kliknięcie zadania na którejś z tych dwóch list otwiera je. Stronę widzi tylko właściciel serwisu.",
  steps: [
    "Na /admin/zadania otwórz zadanie i w „Blokuje” wybierz inne - tamto ma przejść do „Czekają”, z tym zadaniem w swoim „Czeka na”.",
  ],
  link: "/admin/zadania",
  area: "admin",
} satisfies QaItem;
