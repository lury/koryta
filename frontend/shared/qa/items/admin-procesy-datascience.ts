import type { QaItem } from "../../qa";

export const order = 175;

export default {
  id: "admin-procesy-datascience",
  title: "Procesy dla zespołu danych",
  description:
    "Stronę /admin/procesy widzą teraz wszyscy z uprawnieniem datascience, nie tylko właściciel serwisu. Kto nie jest administratorem, ma w menu „Admin” tylko „Procesy”.",
  steps: [
    "Zaloguj się kontem z uprawnieniem datascience, ale bez administratora - w menu „Admin” mają być tylko „Procesy”, a /admin/procesy ma się otworzyć, bez linków do zadań.",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
