import type { QaItem } from "../../qa";

export const order = 288;

export default {
  id: "oswiadczenie-z-data-administratora",
  title: "Oświadczenie na stronie także z datą ustaloną przez administratora",
  description:
    "Strona opublikowana ręcznie, gdy datę z oświadczenia ustalił administrator, pokazuje teraz notkę z oświadczeniem. Automat nadal na takiej dacie nie publikuje.",
  steps: [
    "Na /admin/oswiadczenia wybierz powód „datę ustalił administrator” i rozwiń osobę. Jeśli data się zgadza, kliknij „Opublikuj ręcznie” i opublikuj.",
    "Otwórz stronę osoby: pod danymi jest „Data urodzenia zgadza się z oświadczeniem majątkowym”.",
  ],
  link: "/admin/oswiadczenia",
  area: "admin",
} satisfies QaItem;
