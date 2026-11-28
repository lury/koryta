import type { QaItem } from "../../qa";

export const order = 130;

export default {
  id: "stopka-ma-kontakt",
  title: "W stopce jest wreszcie „Kontakt”",
  description:
    "Stopka opisywana była jako miejsce, w którym stoi adres kontaktowy, i " +
    "nie było w niej ani słowa „Kontakt”, ani adresu - kto go szukał, " +
    "scrollował na sam dół i nic nie znajdował. Teraz w „O projekcie” jest " +
    "link prowadzący prosto do sekcji kontaktowej na stronie „O nas”.",
  steps: [
    "Przewiń stronę główną na sam dół.",
    "W kolumnie „O projekcie” ma być pozycja „Kontakt”.",
    "Kliknij ją - otworzy się /o-nas i przewinie do sekcji z adresem kontakt@koryta.pl.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
