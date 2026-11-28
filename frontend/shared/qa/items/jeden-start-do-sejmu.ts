import type { QaItem } from "../../qa";

export const order = 212;

export default {
  id: "jeden-start-do-sejmu",
  title: "Start do Sejmu albo Senatu nie powtarza się na stronie osoby",
  description:
    "Starsze importy zapisywały kandydaturę do Sejmu, Senatu albo Parlamentu Europejskiego pod miejscem zamieszkania kandydata, a nowsze dopisywały ją drugi raz pod województwem okręgu, więc ten sam start był na stronie dwa razy. Teraz import przenosi taką kandydaturę do województwa okręgu, a 168 zapisanych już dwa razy scala jednorazowa migracja.",
  steps: [
    "Na stronie Michała Jerzego Sobczaka start do Sejmu z 2023 roku jest jeden, przy „łódzkie”, z komitetem Trzeciej Drogi.",
  ],
  link: "/osoba/michal-jerzy-sobczak-1gTpeJh06gps7G2wgEaE",
  area: "public",
} satisfies QaItem;
