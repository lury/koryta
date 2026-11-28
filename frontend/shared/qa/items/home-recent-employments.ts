import type { QaItem } from "../../qa";

export const order = 15;

export default {
  id: "home-recent-employments",
  title: "Co nowego na stronie głównej",
  description:
    "Na dole strony głównej leci lista tego, czego się właśnie " +
    "dowiedzieliśmy, od najświeższego: objęte stanowiska, a między nimi - " +
    "w tym samym porządku dat - okrągłe staże, na kafelkach z konfetti. " +
    "Przewijanie dokłada następne, a kliknięcie kafelka prowadzi do strony " +
    "osoby, nie firmy.",
  steps: [
    "Wejdź na stronę główną i przewiń na sam dół, do sekcji „Co nowego”.",
    "Poszukaj kafelka z konfetti i strzelającą serpentyną przy inicjałach - to czyjś okrągły staż. Ma być w kolorze bursztynowym, a nie zielonym jak reszta.",
    "Sprawdź, gdzie taki kafelek stoi: między zatrudnieniami, dokładnie tam, gdzie wypada jego data - a nie zebrany z innymi na początku albo na końcu listy.",
    "Porównaj z /eksploruj/staz - tam te same osoby mają być bez konfetti, na zwykłych kafelkach.",
    "Sprawdź daty na kafelkach - mają iść od najnowszej w dół, a nie w losowej kolejności.",
    "Porównaj daty na kafelkach: stanowisko wciąż zajmowane („obecnie”) ma mieć datę na zielono, zakończone - na szaro.",
    "Najedź myszą na kafelek - ma się delikatnie unieść, a strzałka po prawej zmienić kolor.",
    "Przewijaj dalej - po chwili ma dojść kolejna porcja, bez klikania czegokolwiek.",
    "Kliknij dowolny kafelek - ma otworzyć stronę osoby, a nie instytucji.",
    "Zwęź okno do szerokości telefonu - kafelki mają ustawić się w jednej kolumnie zamiast dwóch.",
    "Przewiń do samego końca listy - ma pojawić się napis, że to już wszystko, co wiemy.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
