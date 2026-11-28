import type { QaItem } from "../../qa";

export const order = 48;

export default {
  id: "rada-spoleczna-szpitali-nie-jest-zatrudnieniem",
  title: "Rada społeczna szpitala nie liczy się jako zatrudnienie",
  description:
    "Samodzielny publiczny zakład opieki zdrowotnej nie ma rady " +
    "nadzorczej. Ma radę społeczną - organ opiniodawczy z ustawy o " +
    "działalności leczniczej, złożony z przedstawicieli podmiotu " +
    "tworzącego i samorządu, który zbiera się kilka razy w roku i za " +
    "który się nie płaci. W KRS ten organ nazywa się wprost „RADA " +
    "SPOŁECZNA”, ale rejestr.io zgłasza jego członków dokładnie tak samo " +
    "jak członków każdej rady nadzorczej, więc na stronie wszystkie 892 " +
    "takie miejsca w 238 szpitalach były podpisane „Rada Nadzorcza” i " +
    "liczyły się jako praca. Teraz spółki niosą informację o tym, jaki " +
    "mają organ nadzoru, i miejsce w radzie społecznej wypada z kolumn " +
    "„Ostatnie zatrudnienie” i „Lata pracy” oraz z filtra „obecnie " +
    "zatrudnieni” - z tego samego powodu, dla którego nie liczymy pracy " +
    "w spółce, o której nie wiadomo, czy jest publiczna. Dotyczy 758 " +
    "osób; 578 z nich zmieni się data ostatniego zatrudnienia, a 492 " +
    "stracą ją całkiem, bo rada społeczna była jedyną rzeczą, jaką o " +
    "nich wiedzieliśmy. Samo powiązanie zostaje: osoba nadal jest przy " +
    "szpitalu w kolumnie „Firmy” i na grafie, zmieniają się tylko " +
    "liczniki. Dyrektor szpitala liczy się dalej - to etat, a nie " +
    "miejsce w radzie.",
  steps: [
    "Wejdź na stronę dowolnego SPZOZ (np. SPZOZ w Sanoku) i sprawdź w „Historii powiązań”, że członkowie organu nadzoru są podpisani „Rada Społeczna”, a nie „Rada Nadzorcza”.",
    "Na tej samej stronie znajdź dyrektora/kierownika (powiązanie „Zarząd”) i sprawdź, że jego podpis się NIE zmienił.",
    "Wejdź na stronę osoby, która ma tylko miejsce w radzie społecznej szpitala. Powiązanie ma być widoczne, ale „Lata pracy” mają wynosić 0.",
    "Wejdź na /eksploruj/tabela?sortBy=latestEmploymentStart&sortDesc=true - na górze nie powinno być osób, których jedynym powiązaniem jest rada społeczna szpitala.",
    "Wejdź na stronę spółki z prawdziwą radą nadzorczą (np. PKP SKM w Trójmieście) i sprawdź, że tam nadal jest „Rada Nadzorcza” i że lata pracy się liczą.",
    "Na stronie głównej, w „Ostatnio zatrudnieni”, sprawdź kartę z SPZOZ - ma mówić „Rada Społeczna”.",
  ],
  link: "/eksploruj/tabela?sortBy=latestEmploymentStart&sortDesc=true",
  area: "public",
} satisfies QaItem;
