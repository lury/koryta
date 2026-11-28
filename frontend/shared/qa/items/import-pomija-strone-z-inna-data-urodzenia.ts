import type { QaItem } from "../../qa";

export const order = 190;

export default {
  id: "import-pomija-strone-z-inna-data-urodzenia",
  title: "Import nie dopisuje imiennika urodzonego innego dnia",
  description:
    "Import mógł dopisać stronie Krzysztofa Hetmana (ur. 1974) wpis rejestr.io i zarząd jego imiennika urodzonego w 1963 r., bo dopasował ich po samym nazwisku. Teraz strona, która podaje inną datę urodzenia niż dane, nie dostaje z nich nic, a import zgłasza taką osobę w przebiegu jako nieudaną.",
  steps: [
    "Na stronie Krzysztofa Hetmana kliknij „Wyślij dane tej osoby”, a gdy wysyłka się skończy, odśwież stronę - nie ma na niej linku do rejestr.io ani zarządu spółki o KRS 0000087470.",
  ],
  link: "/entity/person/Nd153mxyMKYahquOIsiI",
  area: "admin",
} satisfies QaItem;
