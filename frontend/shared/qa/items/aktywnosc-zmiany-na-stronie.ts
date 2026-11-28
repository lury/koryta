import type { QaItem } from "../../qa";

export const order = 278;

export default {
  id: "aktywnosc-zmiany-na-stronie",
  title: "Aktywność mówi też, co zmieniło się na stronie",
  description:
    "Każda nowa wersja koryta.pl jest na /aktywnosc pod dniem, w którym weszła, z tytułami jej wpisów z /qa.",
  steps: [
    "Otwórz /aktywnosc. Pod dniem ostatniej wersji ma być linijka „Nowa wersja strony” z tytułami wpisów z /qa. Kliknij tytuł: ma pokazać opis i dwa linki.",
    "Kliknij filtr „koryta.pl” nad listą. Mają zostać same nowe wersje strony, po dniach.",
  ],
  link: "/aktywnosc",
  area: "contributor",
} satisfies QaItem;
