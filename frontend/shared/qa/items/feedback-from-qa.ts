import type { QaItem } from "../../qa";

export const order = 13;

export default {
  id: "feedback-from-qa",
  title: "Uwaga z listy QA idzie prosto do zespołu",
  description:
    "Zgłoszony tu problem - i każda uwaga dopisana do wpisu - trafia tam, " +
    "gdzie zgłoszenia z przycisku „Zgłoś”: na kanał zespołu i do panelu. " +
    "Nie trzeba pisać tego samego drugi raz.",
  steps: [
    "Rozwiń dowolny wpis, wpisz uwagę i kliknij „Coś nie działa”.",
    "Sprawdź komunikat na dole - ma powiedzieć, że zgłoszenie poszło do zespołu.",
    "Jako admin wejdź na /admin/opinie: zgłoszenie ma tam być, z chipem „QA” i nazwą wpisu.",
    "Kliknij ten chip - ma wrócić dokładnie na ten wpis na /qa.",
    "Kliknij „Działa” bez wpisywania uwagi przy innym wpisie - to samo sprawdzenie, ale w panelu nic nowego się nie pojawia.",
    "Kliknij drugi raz to samo z tą samą uwagą - też nie ma powstać nowe zgłoszenie.",
  ],
  link: "/qa",
  area: "contributor",
} satisfies QaItem;
