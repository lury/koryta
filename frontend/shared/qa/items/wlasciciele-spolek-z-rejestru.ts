import type { QaItem } from "../../qa";

export const order = 47;

export default {
  id: "wlasciciele-spolek-z-rejestru",
  title: "Spółki mają wreszcie właścicieli",
  description:
    "Strona wiedziała, w jakim mieście spółka jest zarejestrowana, i nic " +
    "poza tym - w całej bazie było 115 powiązań właścicielskich na 4024 " +
    "spółki. KRS podaje udziałowców w dziale 1 i teraz je czytamy: 964 " +
    "wpisy wskazują spółkę po numerze KRS, a 1675 gminę, powiat, " +
    "województwo albo Skarb Państwa. Nazwa właściciela to w rejestrze sam " +
    "tekst, bez kodu TERYT, więc trzeba ją rozwiązać - „GMINA MIASTA " +
    "NOWEGO MIASTA LUBAWSKIEGO” na „Nowe Miasto Lubawskie”. Wcześniej kod " +
    "brało się z siedziby samej spółki, przez co Gmina Miasta Gdańsk, " +
    "mająca 10,7% PKP SKM w Trójmieście, wychodziła jako Gdynia, a " +
    "wszyscy współwłaściciele zlewali się w jednego: Sądeckie Wodociągi " +
    "mają cztery gminy i miały jedną, a żywiecka spółka wodociągowa " +
    "szesnaście i też jedną. Przy okazji siedziba dostała własny typ " +
    "powiązania („siedziba” zamiast „właściciel”), bo inaczej gmina " +
    "będąca właścicielem spółki z sąsiedniego miasta przenosiłaby ją do " +
    "siebie.",
  steps: [
    "Wejdź na stronę PKP SKM w Trójmieście. Ma mieć trzech właścicieli: PKP S.A., Gminę Miasta Gdańsk i Województwo Pomorskie - a jako siedzibę nadal Gdynię.",
    "Sprawdź Sądeckie Wodociągi: cztery różne gminy jako właściciele, nie jedna.",
    "Na /eksploruj/tabela sprawdź kolumnę z regionem - ma pokazywać siedzibę, a nie gminę, która ma udziały.",
    "Użyj filtra „Siedziba spółki” (przycisk „Filtry”, sekcja „Więcej filtrów”) dla dowolnego powiatu i sprawdź, że lista się nie zmieniła w stosunku do tego, co było wcześniej.",
    "Wejdź na stronę gminy (np. Gdańsk) - ma listować i spółki z siedzibą, i te, w których ma udziały.",
    "Na grafie spółki z właścicielem-gminą sprawdź, że linia do siedziby jest podpisana „siedziba”, a do właściciela „właściciel”.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
