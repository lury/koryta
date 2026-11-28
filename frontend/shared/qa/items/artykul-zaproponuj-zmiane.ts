import type { QaItem } from "../../qa";

export const order = 225;

export default {
  id: "artykul-zaproponuj-zmiane",
  title: "Poprawianie tytułu i adresu artykułu",
  description:
    "Zalogowani mają teraz na stronie artykułu ołówek obok tytułu - „Zaproponuj zmianę”, jak na stronie osoby: poprawisz tytuł, który przyszedł z importu jako adres strony albo z dopiskiem „| Newsweek”, a także adres źródła i nazwę skróconą. Artykuł zapisany bez tytułu mówi „Artykuł bez tytułu” i ma ten sam ołówek, a tytuł będący adresem nie wychodzi już na telefonie poza kartę. Przy okazji „Podgląd tej wersji strony” z /admin/rewizje pokazuje propozycję także na stronach osób i instytucji - przekierowanie na adres z nazwą gubiło ją po drodze.",
  steps: [
    "Zaloguj się, otwórz artykuł, którego tytuł jest adresem strony, i kliknij ołówek obok tytułu. Pole „Tytuł” ma pokazywać cały tytuł. Wpisz nowy i kliknij „Zaproponuj” - strona ma pokazać podgląd z nowym tytułem, a pod nim „Twoje propozycje zmian do tej strony”.",
    "Kliknij w tej karcie „Podgląd tej wersji” - ma się otworzyć podgląd z nowym tytułem, a nie strona sprzed zmiany.",
    "Jako admin otwórz tę propozycję w /admin/rewizje - „Podgląd tej wersji strony” ma pokazać nowy tytuł, a po zatwierdzeniu artykuł ma go mieć na stałe. Po wylogowaniu ołówka obok tytułu nie ma.",
  ],
  link: "/artykul/https-nowiny24-pl-wojciech-wasik-nowym-dyrektorem-tarnobrzeskiego-szpitala-ar-6097159-Ts3XLo3Ho2QzOwlOhDJX",
  area: "contributor",
} satisfies QaItem;
