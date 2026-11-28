import type { QaItem } from "../../qa";

export const order = 210;

export default {
  id: "kategoria-obronnosc",
  title: "Kategoria „Obronność” w filtrach",
  description:
    "Spółki zbrojeniowe Skarbu Państwa - PGZ ze spółkami, wojskowe zakłady, spółki AMW - i producenci broni mają własną kategorię. Zawęża nią tabelę i kolejkę nowych osób.",
  steps: [
    "Zalogowany otwórz /eksploruj/nowe i wybierz „Obronność” w „Typ podmiotu” - kolejka ma pokazać osoby ze spółek zbrojeniowych.",
  ],
  link: "/eksploruj/tabela?category=obronnosc",
  area: "public",
} satisfies QaItem;
