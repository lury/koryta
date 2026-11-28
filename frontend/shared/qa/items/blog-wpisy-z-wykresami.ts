import type { QaItem } from "../../qa";

export const order = 192;

export default {
  id: "blog-wpisy-z-wykresami",
  title: "Blog: krótkie analizy z liczbami i wykresami",
  description:
    "Nowa strona /blog na analizy zespołu. Wpis pisze się w markdownie i można w nim osadzić liczby, wykresy z tabelą tych samych liczb, pasek podziału, ramkę i linki do stron osób z bazy. Szkice widać tylko w lokalnej wersji strony.",
  steps: [
    "Otwórz /blog - dopóki nie ma opublikowanego wpisu, strona mówi „Pierwsze wpisy już wkrótce”.",
    "W lokalnej wersji strony otwórz /blog/wzor-wpisu - przy każdym wykresie przełącznik obok tytułu pokazuje tabelę z liczbami, a „Jan Kowalski” w tekście prowadzi do jego strony.",
  ],
  link: "/blog",
  area: "public",
} satisfies QaItem;
