import type { QaItem } from "../../qa";

export const order = 84;

export default {
  id: "rozbicie-wyniku-w-tabeli",
  title: "Wynik w tabeli mówi, skąd się wziął",
  description:
    "Liczba w kolumnie „Głosy łącznie” sumowała głosy ludzi z najwyższą " +
    "oceną modelu, więc czwórka mogła znaczyć cztery zgodne modele albo " +
    "jedną przekonaną osobę - i nie dało się ich odróżnić. Teraz kliknięcie " +
    "w liczbę pokazuje, ile modeli oceniło tę osobę, co każdy z nich " +
    "powiedział i ile osób na nią zagłosowało. Osoby, której nikt i żaden " +
    "model nie ocenił, nadal pokazujemy jako samą liczbę.",
  steps: [
    "Wejdź na /eksploruj/tabela i posortuj malejąco po kolumnie „Głosy łącznie”.",
    "Kliknij liczbę w tej kolumnie przy osobie z góry listy.",
    "Sprawdź, że karta wymienia modele z ich ocenami i liczbę osób, które głosowały.",
    "Sprawdź, że przy kilku modelach karta mówi, iż do wyniku liczy się tylko najwyższa ocena.",
    "Znajdź osobę z wynikiem 0 i sprawdź, że liczba nie jest klikalna.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
