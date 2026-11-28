import type { QaItem } from "../../qa";

export const order = 222;

export default {
  id: "sklad-spolki-z-osobami-bez-strony",
  title: "Strona spółki pokazuje cały obecny skład, a partie po zalogowaniu",
  description:
    "Niezalogowany czytelnik widział w „Obecnym składzie” tylko osoby z opublikowaną stroną, więc ponad połowa stron spółek nie pokazywała nikogo. " +
    "Teraz widzi wszystkich, którzy zasiadają w spółce, z funkcją i datą powołania. Partii osoby bez opublikowanej strony nie widzi: w jej miejscu stoi chip „???” w szarym kolorze chipu „Inne”, z kolorowymi kropkami przy brzegach, a pod składem baner z logowaniem. Po zalogowaniu wszystko jest jak dotąd.",
  steps: [
    "Wyloguj się i otwórz stronę MPWiK w Kamiennej Górze: w „Obecnym składzie” są też osoby bez opublikowanej strony, przy części z nich chip „???”, a pod składem baner „Powiązania polityczne po zalogowaniu”.",
    "Najedź na chip „???”: podpowiedź mówi, że informacja o partii nie jest jeszcze zweryfikowana. Kliknij „Zaloguj się” w banerze i zaloguj się: wracasz na tę samą stronę, a w miejscu chipów stoją partie.",
    "Wylogowany kliknij nazwisko osoby bez opublikowanej strony: otwiera się zapowiedź jej strony z logowaniem.",
    "Na stronie Orlenu osoby z opublikowaną stroną mają swoje partie tak jak dotąd.",
  ],
  link: "/instytucja/miejskie-przedsiebiorstwo-wodociagow-i-kanalizacji-kamienna-gora-KNZZ2oawiqTbeg8xztLX",
  area: "public",
} satisfies QaItem;
