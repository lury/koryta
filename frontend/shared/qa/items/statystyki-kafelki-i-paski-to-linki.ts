import type { QaItem } from "../../qa";

export const order = 161;

export default {
  id: "statystyki-kafelki-i-paski-to-linki",
  title: "Kafelki i paski na stronie statystyk prowadzą tam, gdzie wskazują",
  description:
    "Kafelek „Fakty z ekstrakcji” i części paska „Postęp weryfikacji osób” wyglądały na linki, ale kliknięte nic nie robiły. Teraz to zwykłe linki, które otworzysz też z ctrl albo środkowym przyciskiem w nowej karcie.",
  steps: [
    "Na /eksploruj/statystyki kliknij kafelek „Fakty z ekstrakcji”, a potem zieloną część paska „Postęp weryfikacji osób” - mają przenieść na /ekstrakcje i do tabeli opublikowanych osób.",
  ],
  link: "/eksploruj/statystyki",
  area: "public",
} satisfies QaItem;
