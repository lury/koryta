import type { QaItem } from "../../qa";

export const order = 112;

export default {
  id: "filtr-typu-faktow-na-stronie-osoby",
  title: "Filtr typu faktów na stronie osoby",
  description:
    "Nad kartami w sekcji „Fakty z artykułów” pojawił się rządek chipów " +
    "z typami faktów, które ta osoba faktycznie ma, i liczbą każdego z " +
    "nich - dzięki temu można obejrzeć same relacje rodzinne albo samo " +
    "zatrudnienie obok siebie. Filtrowanie dzieje się w przeglądarce, " +
    "na już pobranych faktach, więc nie kosztuje ani jednego " +
    "dodatkowego zapytania; rządek nie pokazuje się wcale, gdy " +
    "wszystkie fakty są jednego typu.",
  steps: [
    "Zaloguj się i wejdź na stronę osoby, która ma fakty co najmniej dwóch typów (na seedzie: /osoba/anna-nowak-3 ma zatrudnienie i członkostwo partyjne).",
    "Nad kartami ma być rządek chipów: „Wszystkie (N)”, a dalej np. „Zatrudnienie (1)”, „Członkostwo partyjne (1)”.",
    "Kliknij chip „Członkostwo partyjne” - mają zostać tylko karty tego typu, a liczba w chipie ma się zgadzać z liczbą kart.",
    "Kliknij „Wszystkie” - mają wrócić wszystkie karty.",
    "Wejdź na stronę osoby, której wszystkie fakty są jednego typu - rządka chipów ma nie być w ogóle.",
  ],
  link: "/osoba/anna-nowak-3",
  area: "public",
} satisfies QaItem;
