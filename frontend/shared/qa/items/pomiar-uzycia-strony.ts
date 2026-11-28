import type { QaItem } from "../../qa";

export const order = 94;

export default {
  id: "pomiar-uzycia-strony",
  title: "Wiemy wreszcie, w co ludzie na stronie klikają",
  description:
    "Strona zbierała dotąd tylko odsłony - nie było widać ani czego " +
    "szukacie w wyszukiwarce, ani czy ktokolwiek otwiera „Partie” na " +
    "stronie głównej, ani czy formularz wolontariusza kliknęła choć jedna " +
    "osoba. Teraz każde z tych zdarzeń trafia do Plausible pod własną " +
    "nazwą. Nic się nie zmienia w tym, co widać: to ten sam interfejs, " +
    "tylko policzony. Statystyki są zbiorcze i nadal bez ciasteczek.",
  steps: [
    "Na stronie głównej przełącz zakładkę z „Mapa” na „Partie” i z powrotem.",
    "Wpisz coś w wyszukiwarkę i wybierz podpowiedź - albo wpisz nazwisko, którego nie ma, i sprawdź, czy proponuje dodanie osoby.",
    "Kliknij kafelek na mapie, a potem kwadrat partii w drzewie na zakładce „Partie” - oba powinny prowadzić tam, gdzie prowadziły wcześniej.",
    "Wejdź na /pomoc i kliknij dowolny link wychodzący (formularz, Patronite, Slack) - ma się otworzyć w nowej karcie tak jak dotąd.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
