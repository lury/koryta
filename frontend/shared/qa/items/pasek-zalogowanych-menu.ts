import type { QaItem } from "../../qa";

export const order = 148;

export default {
  id: "pasek-zalogowanych-menu",
  title: "Pasek zalogowanych zajmuje mniej miejsca",
  description:
    "Strony administracyjne są teraz w menu „Admin”, a GitHub i dyskusja w affine - w menu „Zespół”. " +
    "Na pasku zostały „Rewizje” i „Aktywność”.",
  steps: [
    "Z konta administratora kliknij „Admin” - menu ma mieć „Panel administracyjny”, „Kolejka zmian”, „Notatki” i „Zgłoszenia”, a przycisk „Admin” ma być podświetlony na każdej z tych stron.",
    "Na stronie głównej kliknij „Zespół” - „Nowy bug w GitHubie” i „Dyskusja w affine” mają się otwierać w nowej karcie.",
  ],
  link: "/",
  area: "contributor",
} satisfies QaItem;
