import type { QaItem } from "../../qa";

export const order = 182;

export default {
  id: "rozszerzenie-link-do-procesu",
  title: "Rozszerzenie: postęp zapisu na stronie Procesy",
  description:
    "Po zapisaniu artykułu rozszerzenie pokazuje pod komunikatem link „Śledź postęp na stronie Procesy”. Prowadzi do tego zapisu na /admin/procesy, gdzie widać ekstrakcję także po zamknięciu okienka - jej błąd albo fakty.",
  steps: [
    "Zapisz artykuł rozszerzeniem i kliknij „Śledź postęp na stronie Procesy” - /admin/procesy ma otworzyć na górze kartę tego zapisu z jego stanem, a w rozwiniętym wierszu „Zapis artykułu z rozszerzenia” ten zapis ma być zaznaczony.",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
