import type { QaItem } from "../../qa";

export const order = 191;

export default {
  id: "procesy-import-liczy-nowe-zatrudnienia",
  title: "Procesy: import osób liczy nowe zatrudnienia i kandydatury",
  description:
    "Licznik „nowych zatrudnień” importu osób pokazywał zawsze 0, choć import dodawał zatrudnienia. Teraz liczy je naprawdę, a obok pokazuje „nowych kandydatur” i „zatrudnień opublikowanych bez przeglądu” - te, które import sam wystawił na stronę.",
  steps: [
    "Rano po nocy otwórz /admin/procesy i rozwiń „Import osób na stronę” - ostatnie uruchomienie ma pokazać liczniki „nowych zatrudnień”, „nowych kandydatur” i „zatrudnień opublikowanych bez przeglądu”.",
    "Gdy to uruchomienie utworzyło jakieś strony („utworzonych” powyżej 0), „nowych zatrudnień” nie powinno być 0 - nowa strona dostaje wszystkie zatrudnienia z wysyłki jako nowe.",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
