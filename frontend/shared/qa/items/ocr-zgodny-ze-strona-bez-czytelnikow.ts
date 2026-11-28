import type { QaItem } from "../../qa";

export const order = 256;

export default {
  id: "ocr-zgodny-ze-strona-bez-czytelnikow",
  title:
    "Data odczytana przez OCR i zgodna ze stroną publikuje osobę bez czytelników",
  description:
    "Gdy program wyraźnie odczyta datę urodzenia z oświadczenia, a strona osoby ma tę samą datę, wycinek nie idzie do czytelników, tylko osoba trafia do kolejki publikacji. Czytelnicy dostają resztę.",
  steps: [
    "Po następnym wgraniu wycinków otwórz /admin/oswiadczenia: kolejka publikacji rośnie, choć nikt nie czytał nowych wycinków.",
  ],
  link: "/admin/oswiadczenia",
  area: "admin",
} satisfies QaItem;
