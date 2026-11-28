import type { QaItem } from "../../qa";

export const order = 11;

export default {
  id: "admin-feedback-queue",
  title: "Kolejka zgłoszeń w panelu admina",
  description:
    "Wszystkie zgłoszenia w jednym miejscu, ze statusem i notatką, a na " +
    "stronie głównej panelu licznik nieruszonych.",
  steps: [
    "Jako admin wejdź na /admin i sprawdź kafelek „Nowe zgłoszenia”.",
    "Przejdź do /admin/opinie i zmień status jednego zgłoszenia.",
    "Odśwież stronę - status i notatka mają się utrzymać, a licznik na /admin zmniejszyć.",
    "Sprawdź, że zgłoszenie anonimowe jest oznaczone jako anonimowe i nie pokazuje konta.",
  ],
  link: "/admin/opinie",
  area: "admin",
} satisfies QaItem;
