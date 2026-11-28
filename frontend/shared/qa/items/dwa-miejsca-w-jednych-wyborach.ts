import type { QaItem } from "../../qa";

export const order = 202;

export default {
  id: "dwa-miejsca-w-jednych-wyborach",
  title: "Ostrzeżenie przed kandydaturami w dwóch miejscach naraz",
  description:
    "Okno publikacji strony publikowało każdą zaznaczoną kandydaturę, także imiennika z innego powiatu w tych samych wyborach. Teraz pokazuje takie kandydatury w osobnym bloku, z latami, w których osoba kandydowała w każdym z tych miejsc; „Zaznacz wszystkie” ich nie zaznacza, a gdy zaznaczysz obie, pod listą pojawia się czerwone ostrzeżenie. Na stronie osoby takie wiersze mają znaczek „dwa miejsca”.",
  steps: [
    "Otwórz „Opublikuj” na szkicu osoby z dwiema kandydaturami z jednego roku w różnych powiatach - są w bloku nad listą, a „Zaznacz wszystkie” ich nie zaznacza.",
    "Zaznacz obie - pod listą pojawia się czerwone ostrzeżenie, a strona i tak się opublikuje, jeśli klikniesz.",
    "Na stronie takiej osoby oba wiersze mają znaczek „dwa miejsca”, a w jego dymku drugie miejsce.",
  ],
  area: "admin",
} satisfies QaItem;
