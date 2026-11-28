import type { QaItem } from "../../qa";

export const order = 146;

export default {
  id: "aktywnosc",
  title: "Strona „Aktywność”: kto co ostatnio zrobił",
  description:
    "Nowa strona dla zalogowanych, z przyciskiem „Aktywność” na pasku: oceny, notatki, propozycje " +
    "zmian i publikacje z ostatnich dni, zebrane w jedną linijkę na osobę i posiedzenie. Nazwę " +
    "widać tylko u osób, które włączyły ją w profilu - reszta to „Anonim”.",
  steps: [
    "Kliknij „Aktywność” na pasku - lista ma być pogrupowana po dniach, z godziną i linkami do stron.",
    "Oceń kogoś w tabeli i wróć po kilku minutach - na górze ma być Twoja linijka z oznaczeniem „Ty”.",
    "Na /profil przełącznik widoczności nazwy ma teraz wspominać także o aktywności.",
  ],
  link: "/aktywnosc",
  area: "contributor",
} satisfies QaItem;
