import type { QaItem } from "../../qa";

export const order = 85;

export default {
  id: "rada-spoleczna-takze-na-stronie-szpitala",
  title: "Rada społeczna nazwana tak samo na stronie szpitala",
  description:
    "Nazwa organu nadzoru była poprawiana tylko tam, gdzie wiersz " +
    "prowadził do instytucji: na stronie osoby i w „Ostatnio " +
    "zatrudnionych”. Na stronie samego szpitala wiersz prowadzi do " +
    "osoby, więc nie było z czego odczytać, jaki organ ma ta " +
    "instytucja - i wszystkie 892 miejsca w radach społecznych 238 " +
    "szpitali były tam nadal podpisane „Rada Nadzorcza”, czyli " +
    "dokładnie na tej stronie, na której najłatwiej to zauważyć. Teraz " +
    "strona instytucji mówi o sobie kartce z powiązaniami, więc podpis " +
    "jest ten sam po obu stronach powiązania. Tak samo w sekcji „Zmiany " +
    "na stanowisku” - nagłówki funkcji biorą nazwę organu z rejestru, " +
    "po obu stronach: na stronie szpitala i na stronie osoby.",
  steps: [
    "Wejdź na stronę szpitala („Wojewódzki Szpital dla Nerwowo i Psychicznie Chorych „Dziekanka” w Gnieźnie”) i sprawdź w „Historii powiązań”, że członkowie organu nadzoru są podpisani „Rada Społeczna”, a nie „Rada Nadzorcza”.",
    "Na tej samej stronie sprawdź nagłówki w „Zmianach na stanowisku” - jeśli jakieś są, mają mówić „Rada Społeczna” i stać zaraz po „Zarządzie”.",
    "Kliknij nazwisko z tej listy i sprawdź, że na stronie osoby to samo powiązanie jest podpisane tak samo.",
    "Wejdź na stronę spółki z prawdziwą radą nadzorczą (np. PKP SKM w Trójmieście) i sprawdź, że tam nadal jest „Rada Nadzorcza”.",
  ],
  link: "/instytucja/wojewodzki-szpital-dla-nerwowo-i-psychicznie-chorych-dziekanka-im-aleksandra-piotrowskiego-w-gnieznie-gniezno-3s7wdCYxNJnOrufj3T7r",
  area: "public",
} satisfies QaItem;
