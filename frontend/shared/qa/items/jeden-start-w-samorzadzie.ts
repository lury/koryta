import type { QaItem } from "../../qa";

export const order = 213;

export default {
  id: "jeden-start-w-samorzadzie",
  title: "Start w wyborach samorządowych nie powtarza się jako „Samorząd”",
  description:
    "Starsze importy zapisywały kandydaturę samorządową jako „Samorząd”, start do sejmiku czasem pod miejscem zamieszkania, a nowsze dopisywały ją drugi raz z nazwą urzędu, więc ten sam start był na stronie dwa razy. Teraz import przenosi do województwa start do sejmiku zapisany pod miejscem zamieszkania, a migracja scala 266 zapisanych już dwa razy tam, gdzie PKW potwierdza, że to jeden start.",
  steps: [
    "Na stronie Michała Jerzego Sobczaka start do sejmiku z 2024 roku jest jeden, przy „łódzkie”. Dwa starty z 2018 roku w powiecie łowickim zostają oba: to dwa różne starty, na burmistrza i do rady miasta.",
  ],
  link: "/osoba/michal-jerzy-sobczak-1gTpeJh06gps7G2wgEaE",
  area: "public",
} satisfies QaItem;
