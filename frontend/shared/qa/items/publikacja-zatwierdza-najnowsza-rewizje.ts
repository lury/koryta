import type { QaItem } from "../../qa";

export const order = 101;

export default {
  id: "publikacja-zatwierdza-najnowsza-rewizje",
  title: "„Opublikuj” działa na stronie bez zatwierdzonej rewizji",
  description:
    "Większość stron nigdy nie miała rewizji zatwierdzonej ręcznie - " +
    "pipeline'y zapisują swoją wersję i tyle - więc przycisk „Opublikuj” " +
    "był szary, a dymek tłumaczył, że strona potrzebuje zatwierdzonej " +
    "rewizji. Teraz publikacja zatwierdza przy okazji najnowszą rewizję " +
    "strony i mówi w oknie, z kiedy jest ta wersja. Szary zostaje tylko " +
    "wtedy, gdy nie ma czego zatwierdzić: wszystkie rewizje są odrzucone " +
    "albo proszą o usunięcie strony.",
  steps: [
    "Wejdź na /admin/rewizje i otwórz stronę bez zielonego znacznika „Zatwierdzona” w żadnej kolumnie.",
    "Sprawdź, że przycisk „Opublikuj” u góry da się kliknąć, a dymek mówi, którą wersję zatwierdzi.",
    "Kliknij „Opublikuj”: w oknie ma być niebieska informacja z datą tej wersji.",
    "Potwierdź i sprawdź, że po odświeżeniu najnowsza kolumna ma znacznik „Zatwierdzona”, a strona jest oznaczona jako opublikowana.",
    "To samo z „Opublikuj” przy nazwisku na stronie osoby - dla strony bez zatwierdzonej rewizji przycisk działa tak samo.",
  ],
  link: "/admin/rewizje",
  area: "admin",
} satisfies QaItem;
