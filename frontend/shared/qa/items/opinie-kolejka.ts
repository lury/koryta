import type { QaItem } from "../../qa";

export const order = 151;

export default {
  id: "opinie-kolejka",
  title: "Zgłoszenia da się ułożyć w kolejkę do zrobienia",
  description:
    "Na /admin/opinie są teraz trzy części zamiast filtra statusu: „Poza kolejką” (tu trafia każde nowe zgłoszenie), " +
    "„Kolejka” (od góry to, czym zajmujemy się najpierw) i zwinięte „Zamknięte”. Kolejność układa się przyciskiem " +
    "„Ułóż kolejkę” - zgłoszenia zwijają się wtedy do jednej linijki, bez statusu i notatki. Zgłoszenie w kolejce " +
    "nie liczy się już do „Nowych zgłoszeń” na /admin.",
  steps: [
    "Przy zgłoszeniu w „Poza kolejką” kliknij „Do kolejki” - ma przejść do „Kolejki” z numerem.",
    "Kliknij „Ułóż kolejkę”, przeciągnij zgłoszenie wyżej (albo użyj strzałki), kliknij „Gotowe” i odśwież stronę - kolejność ma zostać.",
  ],
  link: "/admin/opinie",
  area: "admin",
} satisfies QaItem;
