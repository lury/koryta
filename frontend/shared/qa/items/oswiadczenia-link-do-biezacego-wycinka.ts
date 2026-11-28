import type { QaItem } from "../../qa";

export const order = 251;

export default {
  id: "oswiadczenia-link-do-biezacego-wycinka",
  title: "Na /oswiadczenia link prowadzi do oświadczenia wycinka na ekranie",
  description:
    "„Zobacz całe oświadczenie” pod kartą otwierało oświadczenie poprzedniego, już odczytanego wycinka. Teraz link jest na dole karty i prowadzi do oświadczenia wycinka, który właśnie widać, od pierwszego wycinka.",
  steps: [
    "Na /oswiadczenia pod polem daty jest „Zobacz całe oświadczenie” z adresem BIP-u. Otwórz go: w oświadczeniu jest ta sama linijka z datą urodzenia co na karcie.",
    "Wpisz datę albo kliknij „Pomiń”: link na nowej karcie prowadzi do nowego oświadczenia, a linijka „Zapisane: …” pod kartą nie ma już linku.",
  ],
  link: "/oswiadczenia",
  area: "contributor",
} satisfies QaItem;
