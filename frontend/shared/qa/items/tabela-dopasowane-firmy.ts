import type { QaItem } from "../../qa";

export const order = 237;

export default {
  id: "tabela-dopasowane-firmy",
  title: "Tabela wyróżnia firmy, przez które osoba pasuje do filtrów",
  description:
    "Przy filtrze kategorii, wybranych firm albo siedziby firmy w kolumnie „Firmy” na początek wychodzą firmy, przez które osoba jest w wynikach, wypełnione na zielono, z ikoną kategorii z paska filtrów. Przy „Obecnie zatrudnieni w wybranych” tylko te, w których pracuje teraz. Jeśli żadna z jej firm nie należy do kategorii, ale jest własnością firmy, która należy, przerywana ramka nazywa tę firmę: „grupa TAURON POLSKA ENERGIA (Katowice)”. Przy filtrze regionu wyróżnione są firmy z siedzibą w regionie i starty w wyborach w nim. Tak samo w /eksploruj/nowe.",
  steps: [
    "Otwórz /eksploruj/tabela z kategorią „Obronność” i „Obecnie zatrudnieni w wybranych”. W każdym wierszu pierwsza firma jest na zielonym tle i ma tarczę, a dymek nad nią mówi „pasuje do filtrów”.",
    "Zmień kategorię na „Energetyka”. W części wierszy jest przerywana ramka „grupa …” z nazwą spółki energetycznej, do której należy firma tej osoby.",
    "Wyczyść kategorię i wybierz region, np. Kraków. Wyróżnione są firmy z siedzibą w Krakowie i starty w wyborach w Krakowie, bez ikony kategorii.",
    "Bez filtrów firm i regionu żadna firma nie jest wyróżniona, a kolejność jest jak dotąd.",
  ],
  link: "/eksploruj/tabela?category=obronnosc&currentlyEmployed=selected",
  area: "public",
} satisfies QaItem;
