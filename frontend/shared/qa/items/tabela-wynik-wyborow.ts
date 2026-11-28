import type { QaItem } from "../../qa";

export const order = 230;

export default {
  id: "tabela-wynik-wyborow",
  title: "Tabela pokazuje osobno, kto wybory wygrał, a kto przegrał",
  description:
    "Na górze listy w polu „Wybory” jest „Pokaż: Kandydowali / Wygrali / Przegrali”. „Wygrali” to osoby, które w tych wyborach zdobyły mandat, „Przegrali” - te, które przegrały we wszystkich swoich startach w tych wyborach. Wyniki pochodzą z PKW.",
  steps: [
    "Otwórz tabelę, kliknij „Filtry”, w polu „Wybory” wybierz „Sejm i Senat 2023” i u góry listy kliknij „Wygrali”. Na pasku ma być „Wygrali: Sejm i Senat 2023”, pole ma się nazywać „Wybory: wygrali”, a w każdym wierszu zielony start ze znaczkiem wygranej.",
    "Kliknij „Przegrali” - zielone starty mają być bez znaczka, a dymek ma mówić „Nie wybrany”.",
    "Krzyżyk na filtrze na pasku ma usunąć i wybory, i wynik - tabela wraca do wszystkich osób.",
  ],
  link: "/eksploruj/tabela?election=parliament-2023&electionResult=won",
  area: "public",
} satisfies QaItem;
