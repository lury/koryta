import type { QaItem } from "../../qa";

export const order = 150;

export default {
  id: "wezwanie-do-pomocy-dwa-panele",
  title: "Wezwanie do sprawdzania osób na stronie głównej ma nowy wygląd",
  description:
    "Postęp sprawdzania był wąską kolumną z drobnym podpisem, a pod drobnym drukiem zostawał duży " +
    "pusty margines. Teraz liczby są na niebieskim panelu obok przycisków, a drobny druk mieści się w jednym pasku na dole karty.",
  steps: [
    "Otwórz stronę główną i przewiń do „Zostało jeszcze dużo osób do sprawdzenia” - po lewej ma być niebieski panel z liczbą sprawdzonych osób, legendą i paskiem, po prawej nagłówek i przyciski.",
    "Na telefonie panel z liczbami ma być nad nagłówkiem, a nic nie może wystawać poza ekran.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
