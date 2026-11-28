import type { QaItem } from "../../qa";

export const order = 234;

export default {
  id: "wyszukiwarka-nazwa-w-cudzyslowie",
  title:
    "Wyszukiwarka znajduje spółkę po słowie w cudzysłowie, po mieście i po numerze KRS",
  description:
    'Słowo w cudzysłowie w nazwie z KRS, np. STADNINA KONI "KRASNE" albo HUTA"KOŚCIUSZKO", jest teraz zwykłym słowem nazwy: wystarczy wpisać „krasne” albo „kościuszko”. To samo z kropkami i przecinkami między słowami. Miasto w nawiasie na końcu nazwy spółki działa razem z innym słowem z nazwy, np. „wodociągów myślibórz” albo „orlen płock”, ale sama nazwa miasta dalej pokazuje miasto, a nie wszystkie spółki z niego. Wklejony dziesięciocyfrowy numer KRS podpowiada spółkę z tym numerem.',
  steps: [
    'Gdy nazwy zostaną przeindeksowane po wdrożeniu, wpisz w wyszukiwarkę „krasne” - ma się pojawić STADNINA KONI "KRASNE". Tak samo „sanikom”, „krepol” i „prema” mają znaleźć swoje spółki, a „orlen płock” spółki Orlenu z Płocka.',
    "Wpisz „wodociągów myślibórz” - ma się pojawić PRZEDSIĘBIORSTWO WODOCIĄGÓW I KANALIZACJI (Myślibórz). Samo „myślibórz” ma pokazać Myślibórz i tylko te spółki, które mają to miasto w samej nazwie, a nie w nawiasie.",
    'Wklej „0000029741” - pierwszą podpowiedzią ma być PRZEDSIĘBIORSTWO GOSPODARKI KOMUNALNEJ "SANIKOM" (Lubawka).',
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
