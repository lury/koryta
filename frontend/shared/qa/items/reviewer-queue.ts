import type { QaItem } from "../../qa";

export const order = 3;

export default {
  id: "reviewer-queue",
  title: "Jeden ekran do przeglądania kolejki rewizji",
  description:
    "Kolejka rewizji pokazuje różnicę, przycisk przyjęcia i odrzucenia w " +
    "jednym miejscu, razem z powodem odrzucenia.",
  steps: [
    "Jako admin wejdź na /admin/rewizje/kolejka.",
    "Sprawdź, że różnica wymienia tylko pola, które faktycznie się zmieniają.",
    "Odrzuć rewizję z powodem i sprawdź, że powód widać przy niej później.",
  ],
  link: "/admin/rewizje/kolejka",
  area: "admin",
} satisfies QaItem;
