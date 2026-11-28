import type { QaItem } from "../../qa";

export const order = 200;

export default {
  id: "notatki-o-osobach-dla-zalogowanych",
  title: "Notatki o osobach widzą tylko zalogowani",
  description:
    "Notatka przy osobie to niesprawdzona informacja o kimś z imienia i nazwiska, a czytał ją każdy - także przy osobach, których strony nie są opublikowane. Teraz widzą ją tylko zalogowani; notatki przy spółkach, artykułach i tematach są dalej publiczne.",
  steps: [
    "Wyloguj się i otwórz stronę osoby, przy której ktoś zostawił notatkę - sekcji „Notatki” nie ma, a po zalogowaniu wraca.",
    "Bez logowania otwórz spółkę z notatkami - notatki są widoczne jak dotąd.",
  ],
  area: "public",
} satisfies QaItem;
