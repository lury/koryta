import type { QaItem } from "../../qa";

export const order = 114;

export default {
  id: "ocena-faktow-na-stronie-osoby",
  title: "Fakty można oceniać od razu na stronie osoby",
  description:
    "Karty w sekcji „Fakty z artykułów” dostały te same trzy przyciski " +
    "oceny co kolejka /ekstrakcje - Niepoprawny, Za mało informacji, " +
    "Poprawny - więc kogoś, kogo interesuje jedna osoba, nie trzeba już " +
    "odsyłać do kolejki. Pod spodem jest inny mechanizm niż na " +
    "/ekstrakcje: pojedynczy zapis bez nasłuchu Firestore, bo ta sekcja " +
    "montuje wszystkie karty naraz, a nie po kilka za rozwijaczem.",
  steps: [
    "Zaloguj się i wejdź na stronę osoby z dopasowanymi faktami (na seedzie: /osoba/anna-nowak-3).",
    "Przy każdej karcie, w dolnym pasku, mają być trzy okrągłe przyciski: czerwony krzyżyk, żółty znak zapytania i zielony ptaszek.",
    "Kliknij zielony ptaszek - ma się podświetlić (wypełnić) i zostać podświetlony.",
    "Kliknij go drugi raz - podświetlenie ma zgasnąć (to cofnięcie oceny).",
    "Kliknij żółty znak zapytania, a potem zielony ptaszek - ma zostać podświetlony tylko ptaszek, nie oba naraz.",
    "Przycisk „To nie ta osoba” przy nazwisku ma nadal działać niezależnie od oceny.",
    "Odśwież stronę po minucie (odpowiedź jest cache'owana 60 s) - oceniony fakt ma się nadal pokazywać jako oceniony.",
  ],
  link: "/osoba/anna-nowak-3",
  area: "contributor",
} satisfies QaItem;
