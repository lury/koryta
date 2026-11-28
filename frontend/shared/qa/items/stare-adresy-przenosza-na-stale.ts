import type { QaItem } from "../../qa";

export const order = 219;

export default {
  id: "stare-adresy-przenosza-na-stale",
  title: "Stare adresy stron przenoszą na stałe (301)",
  description:
    "Adres /entity/… i adres ze starą nazwą przenosiły na właściwą stronę tymczasowo (302), więc Google trzymało w indeksie stary adres obok nowego. Teraz przekierowanie jest stałe, a /entity/ z nieistniejącym identyfikatorem odpowiada 404.",
  steps: [
    "Otwórz /entity/person/SVb31mmNOMmlOy1BsPhH z narzędziami deweloperskimi: w zakładce Sieć pierwsze żądanie ma mieć status 301 i nagłówek cache-control: no-store, a strona ma się otworzyć pod adresem z nazwiskiem.",
  ],
  link: "/entity/person/SVb31mmNOMmlOy1BsPhH",
  area: "public",
} satisfies QaItem;
