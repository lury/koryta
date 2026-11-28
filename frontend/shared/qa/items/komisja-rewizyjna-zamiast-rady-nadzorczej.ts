import type { QaItem } from "../../qa";

export const order = 226;

export default {
  id: "komisja-rewizyjna-zamiast-rady-nadzorczej",
  title: "Komisja rewizyjna stowarzyszenia nie jest już radą nadzorczą",
  description:
    "Rejestr.io podaje każde miejsce w organie nadzoru tak samo, więc 979 miejsc w komisjach rewizyjnych 366 instytucji, głównie stowarzyszeń, cechów i izb, było podpisanych „Rada Nadzorcza”. Teraz podpis bierze nazwę organu z KRS, a lata pracy liczą się jak dotąd. Przy okazji wiersz z radą społeczną szpitala albo komisją rewizyjną pokazuje już, kto wcześniej zajmował to miejsce.",
  steps: [
    "Wejdź na stronę Związku Miast Polskich i sprawdź w „Historii powiązań”, że członkowie organu nadzoru są podpisani „Komisja Rewizyjna”, a nie „Rada Nadzorcza”. Tak samo mają mówić linie grafu po kliknięciu „Opisy powiązań” i to samo powiązanie na stronie każdej z tych osób.",
    "Wejdź na stronę spółki z prawdziwą radą nadzorczą (np. PKP SKM w Trójmieście) i sprawdź, że tam nadal jest „Rada Nadzorcza”.",
  ],
  link: "/instytucja/zwiazek-miast-polskich-poznan-QiqnN5TQcf4302VeXQWp",
  area: "public",
} satisfies QaItem;
