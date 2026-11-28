import type { QaItem } from "../../qa";

export const order = 198;

export default {
  id: "zrodla-wykaz-skarbu-panstwa",
  title: "Źródła wymieniają dane na licencji CC BY",
  description:
    "Wykaz spółek Skarbu Państwa Prokuratorii Generalnej, rejestr TERYT z GUS i kody pocztowe GeoNames są na licencji CC BY 4.0, która wymaga podania źródła. /zrodla je teraz wymienia.",
  steps: [
    "Na /zrodla rozwiń „Na czym opiera się ta strona” - pod zastrzeżeniem ma być link do licencji CC BY 4.0 i lista trzech źródeł, każde z linkiem.",
  ],
  link: "/zrodla",
  area: "public",
} satisfies QaItem;
