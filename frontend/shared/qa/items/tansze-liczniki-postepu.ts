import type { QaItem } from "../../qa";

export const order = 134;

export default {
  id: "tansze-liczniki-postepu",
  title: "Liczniki postępu liczone, a nie skanowane",
  description:
    "Pasek postępu nad tabelą czytał wszystkie 9 302 osoby przy każdym " +
    "odświeżeniu cache - to była ponad jedna trzecia wszystkich odczytów z " +
    "bazy. Teraz, gdy nie ma ustawionych filtrów, te same liczby biorą się z " +
    "zapytań zliczających i mają być identyczne. Przy okazji rzadziej " +
    "przeliczają się statystyki bazy (co sześć godzin zamiast co dziesięć " +
    "minut) i tabela szpitali dla zalogowanych (co pięć minut zamiast za " +
    "każdym wejściem) - po zatwierdzeniu zmiany obie odświeżają się od razu, " +
    "jak dotąd.",
  steps: [
    "Wejdź na /eksploruj/tabela i sprawdź, że pasek postępu pokazuje sensowne liczby, a suma „zatwierdzone + sprawdzone + do sprawdzenia” równa się liczbie wszystkich osób.",
    "Ustaw dowolny filtr, np. partię - liczby mają się zmienić i nadal się sumować.",
    "Wejdź na /eksploruj/statystyki i sprawdź, że liczby zgadzają się z paskiem postępu bez filtrów.",
    "Zaloguj się, wejdź na /eksploruj/szpitale, zatwierdź dowolną zmianę i wróć na tę stronę - liczby mają uwzględniać to, co przed chwilą zatwierdziłeś.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
