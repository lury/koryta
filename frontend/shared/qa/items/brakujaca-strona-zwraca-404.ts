import type { QaItem } from "../../qa";

export const order = 127;

export default {
  id: "brakujaca-strona-zwraca-404",
  title: "Nieistniejąca strona zwraca 404",
  description:
    "Adres z nieistniejącym lub niezatwierdzonym identyfikatorem pokazywał " +
    "„Strona nieznaleziona”, ale serwer odpowiadał kodem 200 - dla " +
    "wyszukiwarek wyglądało to jak zwykła, istniejąca strona. Teraz " +
    "odpowiedź ma kod 404. Dla czytelnika nic się nie zmienia.",
  steps: [
    "Otwórz adres osoby i zepsuj końcówkę identyfikatora, np. usuń z niej ostatni znak (same małe litery już nie wystarczą - taki adres przenosi teraz na właściwą stronę).",
    "Strona ma nadal pokazywać „Strona nieznaleziona”.",
    "W narzędziach deweloperskich, w zakładce Sieć, pierwsze żądanie ma mieć status 404.",
  ],
  area: "public",
} satisfies QaItem;
