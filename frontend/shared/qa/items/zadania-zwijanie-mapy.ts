import type { QaItem } from "../../qa";

export const order = 167;

export default {
  id: "zadania-zwijanie-mapy",
  title: "Zadania: zwijanie łańcuchów na mapie i pasek celów nad nią",
  description:
    "Kartę na mapie zadań można zwinąć razem ze wszystkim, co prowadzi tylko do niej - zostaje z niej stos kart. Cele i stosy są też na pasku nad mapą, więc strzałkę można upuścić na nie z każdego miejsca mapy. Stronę widzi tylko właściciel serwisu.",
  steps: [
    "Na /admin/zadania?widok=mapa kliknij „Zwiń wszystkie” - każdy łańcuch ma się zwinąć w stos na swoim końcu, z liczbą schowanych zadań, a stosy mają się pojawić na pasku nad mapą.",
    "Przeciągnij od prawej krawędzi dowolnej karty na cel albo stos na pasku - ma się pojawić strzałka do niego.",
    "Kliknij „Rozwiń wszystkie” - mapa ma wrócić do stanu sprzed zwinięcia.",
  ],
  link: "/admin/zadania?widok=mapa",
  area: "admin",
} satisfies QaItem;
