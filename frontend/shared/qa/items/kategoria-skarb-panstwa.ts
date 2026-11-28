import type { QaItem } from "../../qa";

export const order = 233;

export default {
  id: "kategoria-skarb-panstwa",
  title: "Spółki Skarbu Państwa da się wybrać w filtrze kategorii",
  description:
    "Na liście kategorii, za sektorami, jest „Skarb Państwa”: spółki z wykazu spółek z udziałem Skarbu Państwa Prokuratorii Generalnej, z każdym udziałem. To nie sektor, tylko właściciel, więc spółka ma go obok swojego sektora (PKP S.A.: „Koleje” i „Skarb Państwa”), a wykres „Branże” na stronie głównej go nie liczy. Spółki dostają tę kategorię z najbliższym wgraniem danych spółek.",
  steps: [
    "Otwórz tabelę, kliknij „Filtry” i na liście „Typ podmiotu” (tak nazywa się filtr kategorii) wybierz „Skarb Państwa” - ma być ostatnia. Na pasku ma się pojawić „Skarb Państwa”, a w tabeli osoby ze spółek Skarbu Państwa.",
    "Otwórz stronę PKP S.A. - pod nazwą mają być dwie kategorie, „Koleje” i „Skarb Państwa”, a kliknięcie „Skarb Państwa” ma otworzyć tabelę z tym filtrem.",
    "Na stronie głównej w wykresie „Branże” nie ma linii „Skarb Państwa”.",
  ],
  link: "/eksploruj/tabela?category=skarb-panstwa",
  area: "public",
} satisfies QaItem;
