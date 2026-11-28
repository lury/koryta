import type { QaItem } from "../../qa";

export const order = 281;

export default {
  id: "inne-dla-kandydatow-z-posada",
  title: "Kandydaci z płatną posadą mają co najmniej „Inne”",
  description:
    "Opublikowana osoba z kandydowaniem i płatną posadą w publicznej spółce ma partię. Gdy jej komitet, np. KWW, nie wskazuje żadnej z naszych, jest to szare „Inne”.",
  steps: [
    "Otwórz /osoba/anna-jedynak-rykala-grMjlEK8eMtkDGiXmr04: w danych osoby jest szary znaczek „Inne”.",
  ],
  link: "/osoba/anna-jedynak-rykala-grMjlEK8eMtkDGiXmr04",
  area: "public",
} satisfies QaItem;
