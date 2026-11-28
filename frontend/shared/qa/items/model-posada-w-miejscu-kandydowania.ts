import type { QaItem } from "../../qa";

export const order = 299;

export default {
  id: "model-posada-w-miejscu-kandydowania",
  title: "Model: posada w miejscu kandydowania",
  description:
    "Osoba z posadą w spółce z powiatu, w którym kandydowała (przy Sejmie, Senacie i sejmiku z województwa), dostaje od modeli co najmniej 4, a z najnowszymi takimi posadami 5. Oceny pojawią się po nocnym przeliczeniu.",
  steps: [
    "Otwórz link: tabela pokazuje osoby z oceną od 4. Kliknij ocenę osoby, która kandydowała tam, gdzie pracuje: w „Skąd ten wynik” jest „Posada w miejscu kandydowania”.",
  ],
  link: "/eksploruj/tabela?visibility=private&hideVoted=no_votes&sortBy=latestEmploymentStart&sortDesc=true&minVotes=4",
  area: "contributor",
} satisfies QaItem;
