import type { QaItem } from "../../qa";

export const order = 298;

export default {
  id: "kategoria-w-likwidacji",
  title: "Spółki w likwidacji i w upadłości w filtrze kategorii",
  description:
    "Za „Skarb Państwa” na liście kategorii są „W likwidacji” i „W upadłości”: spółki, którym rejestr dopisał to do nazwy. Spółka ma je obok sektora i właściciela, a wykres „Branże” ich nie liczy. Spółki dostają je z nocnymi aktualizacjami spółek.",
  steps: [
    "Otwórz tabelę, kliknij „Filtry” i w „Typ podmiotu” wybierz „W likwidacji”: w tabeli są osoby ze spółek w likwidacji, np. Telewizji Polskiej. To samo z „W upadłości”.",
    "Otwórz stronę Telewizji Polskiej: pod nazwą jest „W likwidacji”, a kliknięcie otwiera tabelę z tym filtrem.",
  ],
  link: "/eksploruj/tabela?category=w-likwidacji",
  area: "public",
} satisfies QaItem;
