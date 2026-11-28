import type { QaItem } from "../../qa";

export const order = 186;

export default {
  id: "drugie-imie-z-rejestru",
  title:
    "Drugie imię z rejestru na stronie osoby, w grafie samo imię i nazwisko",
  description:
    "Gdy rejestr zna drugie imię osoby, jej strona je nosi - także strona założona wcześniej bez niego, po najbliższym imporcie. W grafie osoba jest podpisana samym imieniem i nazwiskiem, a fakty i wzmianki z artykułów, które drugie imię pomijają, trafiają na jej stronę.",
  steps: [
    "Otwórz stronę Kamila Sebastiana Barczyka - w nagłówku ma oba imiona, a w grafie jego kółko jest podpisane „Kamil Barczyk”.",
    "Po najbliższym nocnym imporcie otwórz stronę Aleksandra Miszalskiego - ma nazywać się „Aleksander Jan Miszalski”, a stary adres ma prowadzić na nowy.",
  ],
  link: "/entity/person/qFxOI9faG9y0TuYuJAMc",
  area: "public",
  fixes: ["ZPDRstUlzvztjywjtym2"],
} satisfies QaItem;
