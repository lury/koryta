import type { QaItem } from "../../qa";

export const order = 286;

export default {
  id: "partia-imiennika-w-oknie-publikacji",
  title: "Okno publikacji pokazuje partię kandydatury w dwóch miejscach",
  description:
    "Przy kandydaturach w dwóch miejscach naraz okno publikacji podaje partię każdej z nich i ostrzega, gdy partię na stronie daje tylko niezaznaczona kandydatura. Publikacja pokazałaby ją na stronie.",
  steps: [
    "Na /admin/oswiadczenia rozwiń osobę wstrzymaną za „kandydatura w dwóch miejscach naraz” i kliknij „Opublikuj ręcznie”.",
    "Przy kandydaturach w bloku „dwa miejsca naraz” są ich partie. Zaznacz kandydaturę z miejsca oświadczenia: pod blokiem może być „Tylko niezaznaczona kandydatura daje partię: …” z linkiem do strony osoby.",
    "Kliknij „Zaznacz wszystkie”: kandydatury z miejsca imiennika zostają niezaznaczone, a ostrzeżenie zostaje. Zamknij okno bez publikacji.",
  ],
  link: "/admin/oswiadczenia",
  area: "admin",
} satisfies QaItem;
