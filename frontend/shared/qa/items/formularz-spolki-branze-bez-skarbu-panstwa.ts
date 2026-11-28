import type { QaItem } from "../../qa";

export const order = 238;

export default {
  id: "formularz-spolki-branze-bez-skarbu-panstwa",
  title: "Formularz spółki pyta o branże, a „Skarb Państwa” idzie za wykazem",
  description:
    "Pole „Kategorie” w „Zaproponuj zmianę” spółki nazywa się teraz „Branże” i nie ma w nim „Skarb Państwa”: tę kategorię bierzemy z wykazu Prokuratorii Generalnej, także dla spółek, którym ktoś ręcznie ustawił branżę, a zapisanie zmian jej nie usuwa.",
  steps: [
    "Na stronie dowolnej spółki kliknij „Zaproponuj zmianę” i rozwiń „Branże”: lista kończy się na „Obronność”, bez „Skarb Państwa”.",
    "Po najbliższym wgraniu danych spółek strona PGE ma pod nazwą „Energetyka” i „Skarb Państwa”, choć jej branżę ustawiono ręcznie.",
  ],
  link: "/instytucja/pge-polska-grupa-energetyczna-lublin-4iiXnBPg693G0zqNkIlt",
  area: "contributor",
} satisfies QaItem;
