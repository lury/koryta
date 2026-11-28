import type { QaItem } from "../../qa";

export const order = 79;

export default {
  id: "zrodla-zaczynaja-sie-od-listy",
  title: "„Źródła” zaczynają się od źródeł",
  description:
    "Stronę otwierało sześć linijek zastrzeżenia prawnego, a sześć linijek " +
    "na monitorze to szesnaście na telefonie: pierwszy tytuł artykułu " +
    "zaczynał się dopiero 670 pikseli niżej, czyli dwa ekrany po tym, jak " +
    "ktoś kliknął „Źródła”. Zastrzeżenie zostaje na górze strony, bo tam " +
    "jest jego miejsce - ale jako jedna linijka, którą się rozwija. Pod " +
    "tabelę go nie przenosimy: to byłoby ukrycie go, a nie skrócenie.",
  steps: [
    "Otwórz /zrodla. Na górze ma być jeden zwijany wiersz „Na czym opiera się ta strona i czego nie twierdzimy”, a nie akapit.",
    "Kliknij go - rozwija się pełny tekst zastrzeżenia, słowo w słowo ten sam co wcześniej.",
    "Na telefonie (375px) tabela ze źródłami ma się zaczynać na pierwszym ekranie.",
  ],
  link: "/zrodla",
  area: "public",
} satisfies QaItem;
