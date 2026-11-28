import type { QaItem } from "../../qa";

export const order = 259;

export default {
  id: "mapa-strony-bez-daty-24-pazdziernika-1408",
  title: "Mapa strony nie podaje już jednej daty dla tysięcy stron",
  description:
    "24 października skrypt dat przypisał każdej stronie w /sitemap.xml tę samą chwilę, 14:08:20, choć opisy zmieniły się o 15:20 i tylko na części stron. " +
    "Po poprawce (skrypt correct-10-24-stamp) każda z nich ma datę tego, co naprawdę się na niej zmieniło, a ponowne przeliczenie dat już tej chwili nie przywraca.",
  steps: [
    "Po uruchomieniu poprawki i wygaśnięciu cache mapy (do siedmiu godzin, krócej po wdrożeniu) otwórz /sitemap.xml, a jeśli jest spisem kilku map, każdą z nich, i wyszukaj „2026-10-24T14:08:20”: nie ma żadnego wyniku.",
    "Artykuł dodany przed 24 października i od tamtej pory niezmieniany ma datę sprzed tego dnia: 24 października nic się na nim nie zmieniło.",
  ],
  link: "/sitemap.xml",
  area: "admin",
} satisfies QaItem;
