import type { QaItem } from "../../qa";

export const order = 216;

export default {
  id: "newsletter-bez-konta",
  title: "Newsletter bez zakładania konta",
  description:
    "Na stronie głównej, nad zachętą do sprawdzania osób, jest teraz formularz zapisu na newsletter dla osób bez konta: wystarczy adres e-mail. Zapis działa dopiero po kliknięciu w link z maila potwierdzającego, a z każdego newslettera można się wypisać jednym kliknięciem. Na produkcji formularz pojawi się, gdy serwis zacznie wysyłać maile.",
  steps: [
    "Wyloguj się i otwórz stronę główną - nad „Zostało jeszcze dużo osób do sprawdzenia” ma być „Newsletter koryta.pl” z polem na adres. Wpisz swój adres i kliknij „Zapisz się” - formularz ma zamienić się w prośbę o sprawdzenie skrzynki.",
    "Otwórz link z maila - strona ma zapytać, zanim cokolwiek zrobi, a po kliknięciu „Potwierdzam zapis” powiedzieć, że newsletter będzie przychodził na ten adres.",
    "Zaloguj się - na stronie głównej formularza już nie ma.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
