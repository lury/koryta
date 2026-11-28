import type { QaItem } from "../../qa";

export const order = 155;

export default {
  id: "rewizje-historia-wpisu",
  title: "Każda rewizja wpisu to linijka z autorem",
  description:
    "Nad porównaniem na stronie rewizji wpisu jest teraz „Historia zmian”: każda rewizja to linijka ze statusem, datą, autorem i zmienionymi polami. " +
    "Po kliknięciu pokazuje różnicę względem zatwierdzonej wersji i decyzje, które zniknęły z kolumn porównania.",
  steps: [
    "Wejdź na /admin/rewizje i otwórz rewizje wpisu, który ma ich kilka - nad porównaniem ma być lista rewizji z autorem przy każdej.",
    "Kliknij oczekującą rewizję - ma się rozwinąć z różnicą, podglądem i przyciskami „Zatwierdź” i „Odrzuć”.",
  ],
  link: "/admin/rewizje",
  area: "admin",
} satisfies QaItem;
