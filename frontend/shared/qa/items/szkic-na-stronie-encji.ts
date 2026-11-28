import type { QaItem } from "../../qa";

export const order = 99;

export default {
  id: "szkic-na-stronie-encji",
  title: "Widać, czy strona jest opublikowana",
  description:
    "Zalogowany czytelnik nie miał jak sprawdzić, czy strona osoby albo " +
    "instytucji, którą właśnie czyta, jest już widoczna publicznie. Przy " +
    "nazwie stoi teraz odznaka „szkic” - taka sama jak w tabeli " +
    "eksploracji - a strona opublikowana nie mówi nic, bo to zwykły stan. " +
    "Admin ma obok niej przycisk „Opublikuj”, więc nie trzeba już " +
    "chodzić po drodze przez listę rewizji. Przy okazji odznaka na stronie " +
    "artykułu przestała kłamać: dla każdego zalogowanego pokazywała " +
    "„szkic” nawet na artykułach dawno opublikowanych.",
  steps: [
    "Zaloguj się i wejdź na stronę opublikowanej osoby - przy nazwisku nie ma żadnej odznaki.",
    "Wejdź na stronę osoby, która czeka na publikację - przy nazwisku stoi pomarańczowa odznaka „szkic”.",
    "Najedź na odznakę: wyjaśnia, że stronę widzą tylko zalogowani.",
    "Jako admin kliknij „Opublikuj” obok odznaki, zatwierdź w oknie - odznaka znika.",
    "To samo sprawdź na stronie instytucji, artykułu i tematu.",
  ],
  area: "contributor",
} satisfies QaItem;
