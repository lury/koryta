import type { QaItem } from "../../qa";

export const order = 121;

export default {
  id: "tabela-podpis-ostatnie-zatrudnienie",
  title:
    "Tabela eksploracji: data pod firmami mówi, że to ostatnie zatrudnienie",
  description:
    "Pod firmami stała sama data („od lipca 2026”) i nic nie mówiło, " +
    "czego dotyczy — czytało się to jak informacja o całym wierszu, a " +
    "jest to początek ostatniego zatrudnienia tej osoby w publicznej " +
    "spółce. Od szerokości tabletu przed datą stoi teraz napis " +
    "„Ostatnie zatrudnienie”, ten sam, którym nazywa się sortowanie w " +
    "menu kolumny; na telefonie zostaje sam kalendarz z datą i opisem " +
    "po najechaniu, bo to tam zabrakło miejsca na etykietę i dlatego " +
    "kiedyś ją usunięto.",
  steps: [
    "Zaloguj się i otwórz /eksploruj/nowe?category=szpitale&currentlyEmployed=selected — pod firmami w kolumnie „Historia” ma stać „Ostatnie zatrudnienie od <miesiąc słownie> <rok>”, a nie sama data.",
    "Najedź kursorem na tę plakietkę: dymek ma dopowiedzieć dzienną datę („Początek ostatniego zatrudnienia w publicznej spółce: 1 marca 2019”).",
    "Otwórz /eksploruj/tabela — podpis ma wyglądać tak samo, a tabela ma się mieścić w karcie, bez poziomego przewijania.",
    "Zwęź okno do 390px: napis „Ostatnie zatrudnienie” ma zniknąć, zostaje ikona kalendarza i sama data, a wiersz nadal nie przewija się w bok.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
