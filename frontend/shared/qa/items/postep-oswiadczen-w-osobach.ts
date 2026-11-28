import type { QaItem } from "../../qa";

export const order = 258;

export default {
  id: "postep-oswiadczen-w-osobach",
  title:
    "Ilu samorządowców sprawdziły oświadczenia: zakładka na głównej i strona /oswiadczenia/postep",
  description:
    "Na stronie głównej obok „Mapa” i „Stanowiska” (dawniej „Wykres”) jest zakładka „Oświadczenia”: ilu samorządowców z płatną posadą opublikowaliśmy dzięki oświadczeniom, ilu jest w toku, ilu bez oświadczenia, i osobno imienników. Prowadzi do /oswiadczenia/postep z pełnymi liczbami i do pierwszego wpisu na blogu. Która zakładka otwiera się pierwsza, zależy od losowania na sesję (po równo dla trzech). Blog jest w menu i w stopce, a /admin/oswiadczenia ma nad wykresem oświadczeń kolorowy pasek osób.",
  steps: [
    "Otwórz stronę główną w kilku nowych kartach: raz otwiera się „Mapa”, raz „Stanowiska”, raz „Oświadczenia”. Kliknij „Oświadczenia”: nagłówek „Oświadczenia majątkowe” i dwa zdania, co sprawdzamy, liczba opublikowanych, pasek, „osobno imiennicy” i słupki dzień po dniu.",
    "W zakładce kliknij „Pełne dane”: /oswiadczenia/postep z sekcjami „W toku”, „Bez oświadczenia” i „Imiennicy”. „Dowiedz się więcej” prowadzi do wpisu na blogu.",
    "W menu na górze i w stopce jest „Blog”, a na /eksploruj/statystyki kafelek „Oświadczenia majątkowe”.",
    "Jako admin otwórz /admin/oswiadczenia: nad „Oświadczenia według stanu” jest pasek osób w tych samych kolorach.",
  ],
  link: "/oswiadczenia/postep",
  area: "public",
} satisfies QaItem;
