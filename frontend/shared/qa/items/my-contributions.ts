import type { QaItem } from "../../qa";

export const order = 4;

export default {
  id: "my-contributions",
  title: "Co się stało z moimi zgłoszeniami",
  description:
    "Profil pokazuje rewizje zgłoszone przez zalogowanego użytkownika wraz " +
    "z decyzją recenzenta.",
  steps: [
    "Zaloguj się i wejdź na /profil.",
    "Znajdź sekcję z własnymi rewizjami i sprawdź statusy (oczekuje / przyjęta / odrzucona).",
    "Kliknij rewizję - ma prowadzić do tego, czego dotyczy.",
  ],
  link: "/profil",
  area: "contributor",
} satisfies QaItem;
