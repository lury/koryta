import type { QaItem } from "../../qa";

export const order = 1;

export default {
  id: "person-search-by-city",
  title: "Szukanie osoby po mieście, w którym pracowała",
  description:
    "Wyszukiwarka osób dopasowuje też miasta pracodawców, nie tylko imię i " +
    "nazwisko.",
  steps: [
    "W wyszukiwarce na górze wpisz nazwę miasta, np. „Katowice”.",
    "Sprawdź, że wśród wyników są osoby zatrudnione w spółkach z tego miasta.",
    "Sprawdź, że szukanie po nazwisku nadal zwraca to co wcześniej.",
  ],
  area: "public",
} satisfies QaItem;
