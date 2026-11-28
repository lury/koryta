import type { QaItem } from "../../qa";

export const order = 173;

export default {
  id: "admin-procesy",
  title: "Procesy: postęp wszystkich jobów na jednej stronie",
  description:
    "Nowa strona /admin/procesy pokazuje, jak idą joby, które zmieniają dane - nocne pobieranie KRS, zapytania do rejestr.io, kompresję lustra, kopię bazy, crawl artykułów i zapisy z rozszerzenia: co trwa i jak daleko doszło, co się nie udało, co nie wystartowało o swojej porze i co od dawna milczy. Na górze jest liczba procesów, które wymagają uwagi, a ich wiersze są od razu rozwinięte. Stronę widzi tylko właściciel serwisu.",
  steps: [
    "Otwórz /admin/procesy - mają być trzy sekcje: „Na żądanie”, „Według harmonogramu” i „Ciągłe”, a nad nimi blok z liczbą procesów wymagających uwagi i „Odświeżono” z godziną.",
    "Rozwiń „Kopia bazy Firestore” - ma pokazać folder ostatniej kopii z godziną startu i końca, a w wierszu „następne:” z jutrzejszą 04:00.",
    "Rozwiń „Zapis artykułu z rozszerzenia” - ma pokazać liczby zapisów z ostatnich 7 dni i ostatnie zapisane strony, każdą z linkiem do artykułu.",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
