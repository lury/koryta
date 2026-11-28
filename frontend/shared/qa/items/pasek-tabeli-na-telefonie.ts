import type { QaItem } from "../../qa";

export const order = 297;

export default {
  id: "pasek-tabeli-na-telefonie",
  title: "Wybrane filtry tabeli czytelne na telefonie",
  description:
    "Na telefonie wybrane filtry mają własny wiersz pod „Filtry”, zamiast ściskać się do samych ikon. „Udostępnij” jest obok tytułu.",
  steps: [
    "Na telefonie otwórz tabelę i wybierz dwa filtry: oba są czytelne w wierszu pod „Filtry”, a liczba osób i sortowanie stoją obok „Filtry”.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
