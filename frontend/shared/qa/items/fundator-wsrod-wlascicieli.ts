import type { QaItem } from "../../qa";

export const order = 255;

export default {
  id: "fundator-wsrod-wlascicieli",
  title:
    "Fundator fundacji wśród jej właścicieli, a fundacja wśród spółek zależnych fundatora",
  description:
    "Fundacja albo stowarzyszenie, które założyła instytucja publiczna (spółka skarbu państwa, gmina, sam skarb państwa), jest teraz instytucją publiczną. Na stronie fundacji jej fundator stoi we „Właścicielach”, z dopiskiem „Fundator” w drugiej linii (albo „Założyciel”, gdy to nie fundacja). Na stronie fundatora fundacja stoi w „Spółkach zależnych” z dopiskiem „założona”. Na telefonie listy właścicieli i spółek zależnych nie mają już ikon po lewej, żeby zmieściło się więcej nazwy.",
  steps: [
    "Po wgraniu firm wejdź na stronę Fundacji Agencji Rozwoju Przemysłu: ma oznaczenie „Instytucja publiczna”, a we „Właścicielach” Agencję Rozwoju Przemysłu z dopiskiem „Fundator”.",
    "Wejdź na stronę Związku Pracodawców Polska Miedź: KGHM jest tam z dopiskiem „Założyciel”.",
    "Wejdź na stronę Totalizatora Sportowego: w „Spółkach zależnych” są Fundacja LOTTO i Fundacja Totalizatora Sportowego z dopiskiem „założona”.",
    "Na telefonie (albo w oknie węższym niż 600 px) listy „Właściciele” i „Spółki zależne” nie mają ikon po lewej. Na komputerze ikony zostają.",
  ],
  link: "/instytucja/fundacja-agencji-rozwoju-przemyslu-warszawa-Esw3DSdEyca7AM6VmPWo",
  area: "public",
} satisfies QaItem;
