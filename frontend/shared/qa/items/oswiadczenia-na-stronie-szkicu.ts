import type { QaItem } from "../../qa";

export const order = 296;

export default {
  id: "oswiadczenia-na-stronie-szkicu",
  title: "Oświadczenia majątkowe na stronie nieopublikowanej osoby",
  description:
    "Zalogowani widzą pod danymi nieopublikowanej osoby ramkę z jej oświadczeniami majątkowymi z BIP: czy wycinek czeka na czytelników, czy strona czeka na publikację albo czemu jest wstrzymana, sam wycinek i link do całego oświadczenia. Gdy wycinka nie ma, ramka wymienia wygrane od 2014 roku wybory samorządowe, co przy każdych znalazło zadanie w BIP, i ma pole na link do oświadczenia znalezionego ręcznie.",
  steps: [
    "Zaloguj się i otwórz stronę nieopublikowanej osoby, która wygrała wybory samorządowe: pod datą urodzenia jest ramka z wycinkiem albo z wygranymi wyborami.",
    "Przy wycinku kliknij „Pokaż wszystkie”: są pozostałe oświadczenia tej osoby, także te, z których nie wycięto daty.",
    "Przy osobie bez wycinka wklej link do jej oświadczenia i kliknij „Dodaj”: link pojawia się w ramce jako dodany dziś przez Ciebie.",
    "Jako admin na stronie wstrzymanej osoby pod stanem jest też podpowiedź, co zrobić.",
    "Kliknij pierwszą linię ramki: ramka się zwija. Wróć na tę stronę: dalej jest zwinięta, a na innych stronach rozwinięta.",
    "Opublikowana osoba nie ma tej ramki.",
  ],
  area: "contributor",
} satisfies QaItem;
