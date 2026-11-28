import type { QaItem } from "../../qa";

export const order = 133;

export default {
  id: "usunieta-partia-zostaje-usunieta",
  title: "Usunięta partia nie wraca po nocnym imporcie",
  description:
    "Import dopisywał partie do tych już zapisanych i nigdy żadnej nie " +
    "zabierał, więc partia skasowana przez redaktora wracała na stronę " +
    "przy najbliższym przebiegu - czasem po niecałej godzinie. Teraz " +
    "zatwierdzona zmiana listy partii oznacza ją jako ustawioną ręcznie i " +
    "import jej już nie rusza. Dotyczy to również wyczyszczenia listy do " +
    "zera.",
  steps: [
    "Zaloguj się i na stronie osoby z kilkoma partiami usuń jedną przez „Zaproponuj zmianę”.",
    "Zatwierdź rewizję w panelu admina.",
    "Partia ma zniknąć ze strony i nie wrócić po kolejnym imporcie.",
    "Uwaga: osoby, którym partie poprawiono przed tą zmianą, nie mają jeszcze tego oznaczenia - trzeba je poprawić raz jeszcze.",
  ],
  area: "contributor",
} satisfies QaItem;
