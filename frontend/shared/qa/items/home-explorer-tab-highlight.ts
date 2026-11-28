import type { QaItem } from "../../qa";

export const order = 139;

export default {
  id: "home-explorer-tab-highlight",
  title: "Widać, która zakładka eksploratora jest wybrana",
  description:
    "Wybrana zakładka („Mapa” albo „Wykres”) była malowana firmowym " +
    "jasnozielonym - jaśniejszym niż czarny napis zakładki niewybranej, więc " +
    "kliknięcie wyglądało jak wygaszenie, a nie jak zaznaczenie. Teraz jest " +
    "ciemnozielona, razem z kreską pod spodem.",
  steps: [
    "Wejdź na stronę główną i popatrz na zakładki „Mapa” i „Wykres” nad eksploratorem: wybrana ma być ciemnozielona i podkreślona, niewybrana czarna.",
    "Kliknij drugą zakładkę - podświetlenie i kreska mają przeskoczyć na nią.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
