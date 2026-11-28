import type { QaItem } from "../../qa";

export const order = 109;

export default {
  id: "spolka-nie-wypisana-dwa-razy",
  title: "Spółka nie jest wypisana dwa razy na jednej stronie",
  description:
    "Na stronie instytucji każde powiązanie własnościowe pojawiało się " +
    "dwukrotnie: raz w „Właściciele” albo „Spółki zależne”, a zaraz potem " +
    "jeszcze raz w „Historia powiązań”. Teraz historia pokazuje tylko to, " +
    "czego nie ma w listach powyżej.",
  steps: [
    "Otwórz stronę spółki, która ma właściciela i spółki zależne.",
    "Sprawdź, że firmy z „Właściciele” i „Spółki zależne” nie powtarzają się niżej w „Historia powiązań”.",
    "Sprawdź, że zatrudnienia i pozostałe powiązania są w historii tak jak wcześniej.",
  ],
  area: "public",
} satisfies QaItem;
