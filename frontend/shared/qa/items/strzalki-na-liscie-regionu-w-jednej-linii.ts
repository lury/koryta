import type { QaItem } from "../../qa";

export const order = 81;

export default {
  id: "strzalki-na-liscie-regionu-w-jednej-linii",
  title: "Strzałki na liście osób regionu stoją w jednej kolumnie",
  description:
    "Na stronie głównej, po kliknięciu powiatu, strzałka w wierszu osoby z " +
    "partią stała kilka pikseli niżej niż w wierszu bez partii. Teraz " +
    "wszystkie są na jednej wysokości, a bardzo długa nazwa partii kończy " +
    "się wielokropkiem zamiast wypychać strzałkę. Kilka partii w jednym " +
    "wierszu układa się w dwie linie, więc na wąskim telefonie strzałka " +
    "też zostaje na karcie.",
  steps: [
    "Kliknij powiat na mapie, w którym ktoś ma partię, i porównaj strzałki w wierszach z partią i bez.",
    "Warszawa na telefonie: osoba z trzema partiami ma strzałkę tam, gdzie pozostałe wiersze.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
