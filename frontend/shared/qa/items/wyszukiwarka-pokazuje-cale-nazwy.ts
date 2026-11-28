import type { QaItem } from "../../qa";

export const order = 117;

export default {
  id: "wyszukiwarka-pokazuje-cale-nazwy",
  title: "Wyszukiwarka pokazuje całe nazwy",
  description:
    "Podpowiedzi w wyszukiwarce ucinały długie nazwy wielokropkiem, " +
    "więc dwóch szpitali czy spółek o podobnym początku nazwy nie dało " +
    "się od siebie odróżnić. Nazwa zawija się teraz do kolejnej linii, " +
    "a lista podpowiedzi może być trochę szersza niż samo pole.",
  steps: [
    "Wpisz „szpital” w wyszukiwarkę w nagłówku strony.",
    "Sprawdź, że długie nazwy (np. „Samodzielny Publiczny Zakład Opieki Zdrowotnej Wojewódzki Szpital Specjalistyczny nr 3 w Rybniku”) widać w całości, w kilku liniach, a nie ucięte wielokropkiem.",
    "Wpisz „PO” i sprawdź, że przy partii nazwa jest nad podpisem „Partia”, a nie pod nim.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
