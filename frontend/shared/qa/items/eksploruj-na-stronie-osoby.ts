import type { QaItem } from "../../qa";

export const order = 40;

export default {
  id: "eksploruj-na-stronie-osoby",
  title: "Przycisk „Eksploruj” na stronie osoby",
  description:
    "Na stronie osoby, obok „Rewizji”, admin ma teraz przycisk " +
    "„Eksploruj” - ten sam, co ikonka w tabeli na /eksploruj. Otwiera " +
    "naraz rejestr.io, Wikipedię i wyszukiwarkę Google dla nazwiska, dla " +
    "nazwiska z „PKW” oraz dla każdej miejscowości, w której ta osoba " +
    "kandydowała. Wcześniej sprawdzenie osoby znalezionej przez " +
    "wyszukiwarkę wymagało odszukania jej jeszcze raz w tabeli.",
  steps: [
    "Zaloguj się jako admin i wejdź na stronę osoby, np. z wyników wyszukiwania. Obok przycisku „Rewizje” ma być „Eksploruj”.",
    "Wyłącz blokowanie wyskakujących okien i kliknij „Eksploruj” - ma się otworzyć karta rejestr.io, karta Wikipedii i po jednej karcie Google dla każdego zapytania.",
    "Sprawdź na osobie, która kandydowała w wyborach - wśród kart Google ma być wyszukiwanie „imię nazwisko <miejscowość>” dla jej okręgu.",
    "Wyloguj się (albo zaloguj jako zwykły użytkownik) i odśwież tę samą stronę - przycisku ma nie być, tak samo jak „Rewizji”.",
    "Zwęź okno poniżej 960 px - oba przyciski chowają się razem, jak dotąd.",
  ],
  area: "admin",
} satisfies QaItem;
