import type { QaItem } from "../../qa";

export const order = 54;

export default {
  id: "publikacja-strony-bez-powiazan-mowi-o-tym",
  title: "Nieudana publikacja powiązań mówi, że strona i tak poszła na żywo",
  description:
    "Strona i jej powiązania publikują się dwoma osobnymi zapisami, a " +
    "powiązania idą albo wszystkie, albo żadne. Jeśli któreś zostanie " +
    "odrzucone - druga strona wróciła do szkicu między otwarciem okna a " +
    "kliknięciem - strona jest już widoczna publicznie, a żadne powiązanie " +
    "nie. Wcześniej widać było samą treść błędu z serwera, więc wyglądało " +
    "to, jakby nie stało się nic; teraz okno mówi wprost, która połowa " +
    "się udała, i wskazuje kolejkę powiązań, bo na opublikowanej stronie " +
    "to okno już się nie otworzy.",
  steps: [
    "Jako admin wejdź na /admin/rewizje/<id> nieopublikowanej osoby, która ma powiązania czekające na publikację, i kliknij przełącznik publikacji.",
    "Zaznacz powiązania i opublikuj. Normalny przypadek: znika okno, na dole komunikat „Opublikowano stronę i N powiązań”.",
    "Żeby zobaczyć nowy komunikat, doprowadź do odmowy: w drugiej karcie ukryj instytucję, do której prowadzi jedno z zaznaczonych powiązań, i dopiero wtedy kliknij „Opublikuj”.",
    "W oknie ma się pokazać czerwona ramka „Strona została opublikowana, ale powiązania nie”, pod nią powód z serwera z nazwą blokującej strony, a pod nim odnośnik do kolejki powiązań.",
    "Okno ma zostać otwarte z zaznaczeniami, a przełącznik publikacji na stronie pod spodem ma się przestawić na „opublikowana” - bo taka jest prawda w bazie.",
    "Zamknij okno i otwórz je ponownie (na innej, nieopublikowanej stronie): czerwonej ramki ma już nie być.",
  ],
  link: "/admin/krawedzie",
  area: "admin",
} satisfies QaItem;
