import type { QaItem } from "../../qa";

export const order = 89;

export default {
  id: "osoba-wspomniana-w-artykulach",
  title: "Na stronie osoby i spółki widać artykuły, które o nich wspominają",
  description:
    "Sekcja była w kodzie od dawna i nigdy nic nie pokazywała: brała " +
    "powiązania z grafu, a graf z założenia wyrzuca wszystko, co dotyka " +
    "artykułu. Teraz czyta je osobno - i te znalezione przez model, i te " +
    "dopisane ręcznie na stronie artykułu, i te powstałe z dopisania źródła " +
    "do notatki. Najnowsze na górze. Powiązanie czekające na zatwierdzenie " +
    'widzą tylko zalogowani, z plakietką "szkic".',
  steps: [
    "Wejdź na stronę osoby, o której pisała prasa.",
    'Zjedź do sekcji "Artykuły, które o tym wspominają".',
    "Sprawdź, że kafelek prowadzi na stronę artykułu i pokazuje domenę oraz datę.",
    "To samo na stronie spółki.",
    "Wyloguj się: szkice powinny zniknąć, opublikowane zostać.",
  ],
  area: "public",
} satisfies QaItem;
