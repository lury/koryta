import type { QaItem } from "../../qa";

export const order = 153;

export default {
  id: "tabela-bez-opcji-wszystkie",
  title: "Tabela nie proponuje już pokazania wszystkich wierszy naraz",
  description:
    "Opcja „Wszystkie” w liczbie wierszy na stronę kończyła się błędem i pustą tabelą. Zostały 10, 25, 50 i 100, a stary link z tą opcją otwiera tabelę z 10 wierszami.",
  steps: [
    "Otwórz /eksploruj/tabela i rozwiń „Wierszy na stronę” na dole tabeli - mają być tylko 10, 25, 50 i 100.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
