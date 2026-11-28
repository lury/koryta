import type { QaItem } from "../../qa";

export const order = 122;

export default {
  id: "graf-legenda-rodzajow-linii",
  title: "Legenda grafu tłumaczy linie ciągłe i przerywane",
  description:
    "Graf od zawsze odróżniał rodzaje powiązań kolorem i kreską, ale " +
    "nigdzie tego nie tłumaczył — czytelnik napisał z pytaniem, czym " +
    "różni się linia ciągła od kropkowanej. W pasku nad grafem, obok " +
    "legendy kształtów, stoi teraz druga legenda nazywająca każdy styl " +
    "linii, i wymienia wyłącznie te rodzaje powiązań, które graf " +
    "faktycznie rysuje.",
  steps: [
    "Wejdź na stronę osoby z grafem, np. /osoba/boguslaw-nadolnik-aiEctjVbbp5CngABStah",
    "W pasku nad grafem, po prawej od legendy kształtów („Osoba”, „Instytucja”, „Region”), sprawdź listę stylów linii: „Zatrudnienie” jest jedyną linią ciągłą, pozostałe („Właściciel”, „Siedziba”, „Kandydatura”, „Znajomość”, „Wzmianka w artykule lub notatce”) są przerywane",
    "Porównaj grubość i wzór kreski w legendzie z liniami na płótnie — mają być identyczne",
    "Przełącz zasięg na „2 kroki”: gdy dochodzą nowe rodzaje powiązań, legenda dopisuje je sama; rodzaje, których na płótnie nie ma, nie są wymieniane",
    "Wejdź na stronę instytucji bez kandydatur i sprawdź, że nie ma tam pozycji „Kandydatura”",
  ],
  link: "/osoba/boguslaw-nadolnik-aiEctjVbbp5CngABStah",
  area: "public",
} satisfies QaItem;
