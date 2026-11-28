import type { QaItem } from "../../qa";

export const order = 267;

export default {
  id: "wyszukiwarka-pusta-po-wyborze",
  title: "Wyszukiwarka jest pusta po wybraniu wyniku",
  description:
    "Wybrana pozycja zostawała w polu wyszukiwania, więc kolejne nazwisko trafiało w jej środek, na przykład „Lista wszystkich ospaób”. Teraz po każdym wyborze pole jest puste i można od razu szukać dalej.",
  steps: [
    "Na /eksploruj/tabela wybierz w wyszukiwarce „Lista wszystkich osób”: pole ma być puste. Wpisz nazwisko: ma trafić do pustego pola, a wyszukiwarka ma znaleźć osobę.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
