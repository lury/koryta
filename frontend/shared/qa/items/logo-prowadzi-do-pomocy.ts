import type { QaItem } from "../../qa";

export const order = 106;

export default {
  id: "logo-prowadzi-do-pomocy",
  title: "Logo na stronie głównej prowadzi do „Pomóż nam”",
  description:
    "Kliknięcie logo otwierało konkretną nagrodę na zrzutce - limitowaną " +
    "przypinkę - która jest już nieaktualna. Teraz prowadzi na /pomoc, " +
    "gdzie jest aktualna prośba.",
  steps: [
    "Wejdź na stronę główną na komputerze i kliknij logo po lewej - ma otworzyć /pomoc, a nie zrzutkę.",
  ],
  area: "public",
} satisfies QaItem;
