import type { QaItem } from "../../qa";

export const order = 166;

export default {
  id: "zadania-cele",
  title: "Zadania: cele, które grupują zadania",
  description:
    "Nowy rodzaj zadania - cel. Cel czeka na zadania, które do niego prowadzą, i tak się je grupuje: cele mają własną listę na górze, z tym, ile z tych zadań już zamknięto, a filtr „Cel” zostawia tylko jego zadania. Stronę widzi tylko właściciel serwisu.",
  steps: [
    "Na /admin/zadania dodaj zadanie rodzaju „Cel” i w „Prowadzą do niego” wybierz dwa zadania - cel ma się pojawić na liście „Cele” z „0/2”.",
    "Otwórz cel i kliknij „Pokaż jego zadania” - na liście i na mapie mają zostać tylko on i te dwa zadania, a na mapie cel ma być ciemną kartą.",
  ],
  link: "/admin/zadania",
  area: "admin",
} satisfies QaItem;
