import type { QaItem } from "../../qa";

export const order = 36;

export default {
  id: "postep-weryfikacji-po-zalogowaniu",
  title: "Postęp weryfikacji tylko dla zalogowanych",
  description:
    "Pasek „Postęp weryfikacji” nad tabelą na Eksploruj pokazuje się " +
    "dopiero po zalogowaniu. Mówi, ile wpisów zostało sprawdzonych, i " +
    "prowadzi do ekranu, na którym się je sprawdza - czyli do dwóch " +
    "rzeczy, których niezalogowany czytelnik i tak nie zrobi. Na telefonie " +
    "zabierał przy tym większość miejsca nad pierwszym wierszem tabeli.",
  steps: [
    "Wyloguj się i wejdź na /eksploruj/tabela. Nad tabelą nie ma postępu weryfikacji - po pasku zapytania od razu idzie tabela. (Od czasu paska zapytania postęp jest drugą linijką tego paska, a nie osobną kartą.)",
    "To samo na wąskim ekranie: pierwszy wiersz tabeli ma być widoczny bez przewijania.",
    "Zaloguj się i odśwież. Postęp ma wrócić jako druga linijka paska zapytania, razem z „Twój wkład” i przyciskiem „Pomóż sprawdzać” - na każdej szerokości, także na telefonie.",
    "Wejdź na /eksploruj/nowe (tylko dla zalogowanych). Tam pasek zostaje pełną kartą z legendą, jak wcześniej.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
