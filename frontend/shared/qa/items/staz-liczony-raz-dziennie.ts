import type { QaItem } from "../../qa";

export const order = 294;

export default {
  id: "staz-liczony-raz-dziennie",
  title: "Okrągłe staże liczone raz dziennie",
  description:
    "Karty okrągłego stażu liczą się raz na dobę zamiast co godzinę, co obniża koszt bazy. Osoba opublikowana dziś trafi na nie jutro, a zdjęta ze strony znika w ciągu godziny.",
  steps: [
    "Wejdź na /eksploruj/staz: są karty i liczby przy „Nadchodzące” i „Minione”. Na stronie głównej w „Co nowego” są karty stażu.",
  ],
  link: "/eksploruj/staz",
  area: "public",
} satisfies QaItem;
