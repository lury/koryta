import type { QaItem } from "../../qa";

export const order = 164;

export default {
  id: "zadania-lista-i-mapa",
  title: "Zadania właściciela: lista i mapa tego, co na co czeka",
  description:
    "Nowa strona /admin/zadania zbiera to, co zostało do wdrożenia, uruchomienia, zdecydowania i zbudowania - także to, co agenci zostawiają po sesji. Na mapie widać, co na co czeka, a zadania łączy się strzałkami. Stronę widzi tylko właściciel serwisu, więc tylko on może to sprawdzić - pozostali mogą ten wpis pominąć.",
  steps: [
    "Na /admin/zadania otwórz zadanie z listy „Czekają” - ma pokazać, na co czeka, co po nim odblokuje i jego historię.",
    "Przełącz na „Mapa” i przeciągnij od prawej krawędzi jednego zadania do lewej krawędzi drugiego - ma pojawić się strzałka, a drugie zadanie ma przejść do „Czekają”.",
    "Kliknij tę strzałkę i „Usuń zależność” - strzałka ma zniknąć, a zadanie wrócić na swoją listę.",
  ],
  link: "/admin/zadania",
  area: "admin",
} satisfies QaItem;
