import type { QaItem } from "../../qa";

export const order = 229;

export default {
  id: "tabela-filtr-wyborow",
  title: "Tabela filtruje osoby po wyborach, w których kandydowały",
  description:
    "W „Filtrach” tabeli jest nowe pole „Wybory”: wybierz np. „Sejm i Senat 2023”, a tabela pokaże wszystkich, którzy w 2023 roku kandydowali do Sejmu albo do Senatu. Kilka wyborów naraz to osoby z którychkolwiek z nich. W kolumnie „Wybory” start, który pasuje do filtra, jest zielony, a wygrane mają znaczek. Niezalogowani widzą tylko opublikowane kandydatury.",
  steps: [
    "Otwórz tabelę, kliknij „Filtry” i w polu „Wybory” wybierz „Sejm i Senat 2023”. Na pasku ma się pojawić „Wybory: Sejm i Senat 2023”, a w kolumnie „Wybory” każdej osoby zielony start z 2023 roku.",
    "Dodaj „Samorządowe 2024” - na pasku ma być „Wybory: 2”, a tabela ma pokazać osoby z którychkolwiek z tych wyborów. Krzyżyk na tym filtrze ma wrócić do wszystkich osób.",
    "Najedź na start ze znaczkiem - dymek ma mówić „Wybrany”.",
    "Skopiuj link przyciskiem udostępniania i otwórz go w oknie prywatnym - ma pokazać ten sam filtr, a w tabeli tylko opublikowane osoby z opublikowaną kandydaturą.",
  ],
  link: "/eksploruj/tabela?election=parliament-2023",
  area: "public",
} satisfies QaItem;
