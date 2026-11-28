import type { QaItem } from "../../qa";

export const order = 307;

export default {
  id: "partie-w-czasie-karta",
  title: "Link do „Partie w czasie” ma w podglądzie sam wykres",
  description:
    "Podgląd udostępnionego linku to wykres z typem podmiotu i latami z tego linku.",
  steps: [
    "Wklej adres tej pozycji na Facebooku albo w Slacku (bez wysyłania): podgląd to wykres „Stanowiska wg partii: Szpitale” za lata 2014-2026.",
    "Zmień typ podmiotu albo lata i wklej nowy adres: wykres w podglądzie zmienia się z nimi.",
    "Link do „Firmy wg powiązań politycznych” ma dalej obrazek serwisu.",
  ],
  link: "/eksploruj/autograf/partie-w-czasie?kategoria=szpitale&od=2014&do=2026",
  area: "public",
} satisfies QaItem;
