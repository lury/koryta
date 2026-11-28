import type { QaItem } from "../../qa";

export const order = 257;

export default {
  id: "bez-liczby-osob-przy-wlascicielach",
  title: "Bez liczby w nawiasie przy właścicielach i spółkach zależnych",
  description:
    "Listy „Właściciele” i „Spółki zależne” nie pokazują już liczby w nawiasie po nazwie. Ta liczba nie mówiła, ile osób ma instytucja, tylko ile ich było w grupie na tej jednej stronie, więc przy wszystkich fundatorach Polskiej Fundacji Narodowej stało to samo „(11)”. Wiersze idą teraz alfabetycznie.",
  steps: [
    "Wejdź na stronę dowolnej spółki z właścicielami albo spółkami zależnymi, na przykład PKP SKM: przy nazwach nie ma liczby w nawiasie, a wiersze idą alfabetycznie.",
  ],
  link: "/instytucja/pkp-szybka-kolej-miejska-w-trojmiescie-gdynia-ZBcdQ9tUxVyv0o1mnpLH",
  area: "public",
} satisfies QaItem;
