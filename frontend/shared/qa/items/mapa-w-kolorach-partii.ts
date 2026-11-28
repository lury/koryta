import type { QaItem } from "../../qa";

export const order = 283;

export default {
  id: "mapa-w-kolorach-partii",
  title: "Mapa na stronie głównej w kolorach partii",
  description:
    "Powiat ma kolor partii, którą ma najwięcej jego osób, tym ciemniejszy, im większy jej udział. Nad mapą każda partia ma swoją mapę udziału. Kolory partii pojawiają się po nocnym przeliczeniu, wcześniej mapa pokazuje liczbę osób w sześciu odcieniach czerwieni.",
  steps: [
    "Otwórz stronę główną: powiaty są pomarańczowe (PO), granatowe (PiS) i zielone (PSL), a nie jednakowo różowe.",
    "Kliknij „PiS” nad mapą: mapa i legenda pod nią pokazują udział PiS w każdym powiecie.",
    "Najedź na powiat: dostaje obrys, a podpowiedź wymienia osoby z każdej partii.",
    "Kliknij powiat: zostaje obrysowany, a obok jest lista jego osób. Kliknij go drugi raz albo ✕ na liście: zaznaczenie znika.",
    "Na telefonie przesuń rząd partii w bok.",
  ],
  link: "/?widok=mapa",
  area: "public",
} satisfies QaItem;
