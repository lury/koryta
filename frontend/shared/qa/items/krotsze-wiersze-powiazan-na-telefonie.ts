import type { QaItem } from "../../qa";

export const order = 123;

export default {
  id: "krotsze-wiersze-powiazan-na-telefonie",
  title: "Krótsze wiersze „Historii powiązań” na telefonie",
  description:
    "Na telefonie wiersz powiązania stracił ikonę po lewej (56 px, " +
    "które i tak powtarzały to, co mówi nazwa instytucji), nazwa skraca " +
    "się do dwóch linijek zamiast zawijać się na trzy, a pasek długości " +
    "zatrudnienia - który przy szerokości 375 px był i tak obcięty z " +
    "obu stron - ustąpił miejsca samym datom w linijce z nazwą funkcji. " +
    "Na szerokim ekranie nic się nie zmienia: ikona, pełna nazwa i " +
    "pasek zostają tam, gdzie były.",
  steps: [
    "Otwórz na telefonie stronę osoby z kilkoma powiązaniami (albo zwęź okno przeglądarki poniżej 600 px).",
    "W sekcji „Historia powiązań” sprawdź, że wiersze są wyraźnie niższe niż wcześniej i że pięć powiązań mieści się na ekranie.",
    "Sprawdź, że długa nazwa instytucji zajmuje najwyżej dwie linijki i kończy się wielokropkiem - pełna nazwa jest w dymku po najechaniu lub przytrzymaniu.",
    "Sprawdź, że daty (np. „2014-11-06 - obecnie”) stoją teraz na końcu linijki z funkcją, a osobnego paska pod spodem już nie ma.",
    "Rozszerz okno powyżej 960 px: ikona, pełna nazwa i pasek długości zatrudnienia wracają.",
  ],
  link: "/osoba/maciej-sulgan-qlQRcKSMw1YLZJjNB71M",
  area: "public",
} satisfies QaItem;
