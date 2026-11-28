import type { QaItem } from "../../qa";

export const order = 240;

export default {
  id: "osoba-oswiadczenia-majatkowe",
  title: "Strona osoby pokazuje jej oświadczenia majątkowe z BIP",
  description:
    "Gdy oświadczenie majątkowe z BIP potwierdza datę urodzenia osoby, pod jej danymi jest jedna linia, że data się zgadza, a przy stronie opublikowanej automatycznie także kiedy ją opublikowano. Same oświadczenia są pierwszymi kartami w sekcji z artykułami, która przy artykułach i oświadczeniach nazywa się „Prasa i dokumenty”.",
  steps: [
    "Otwórz stronę osoby z sekcji „Opublikowane ostatnio” na /admin/oswiadczenia. Przy stronie, którą opublikował automat (otwarty wiersz mówi „opublikowana automatycznie”; to czeka na włączenie publikowania automatycznego), pod danymi osoby ma być linia „Strona opublikowana automatycznie …: data urodzenia zgadza się z oświadczeniem majątkowym” (przy dwóch i więcej „z oświadczeniami majątkowymi”), a (i) obok mówi, jak odczytujemy daty. Strona opublikowana przyciskiem „Opublikuj z kolejki” (wiersz mówi „opublikowana przez administratora”) i strona, która była już publiczna, gdy odczyt potwierdził datę, mają samą linię „Data urodzenia zgadza się z …”, bez słowa o publikacji automatycznej; strony już publiczne przegląd tylko liczy („już publiczne, data się zgadza”).",
    "Kliknij link w tej linii: strona ma zjechać do sekcji „Prasa i dokumenty” (bez artykułów: „Oświadczenie majątkowe”, a przy dwóch i więcej „Oświadczenia majątkowe”), gdzie karta oświadczenia otwiera BIP w nowej karcie.",
  ],
  area: "admin",
} satisfies QaItem;
