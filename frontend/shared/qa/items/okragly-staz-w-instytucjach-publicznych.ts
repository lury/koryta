import type { QaItem } from "../../qa";

export const order = 102;

export default {
  id: "okragly-staz-w-instytucjach-publicznych",
  title: "Okrągły staż w instytucjach publicznych",
  description:
    "Nowa strona /eksploruj/staz pokazuje, komu łączny staż w instytucjach " +
    "publicznych wypada równo - 10 lat, 15 lat, 24 lata - w tym miesiącu " +
    "wstecz albo naprzód. To nie jest rocznica objęcia jednego stanowiska: " +
    "sumujemy wszystkie posady, więc równoległe liczą się raz, a przerwy w " +
    "karierze przesuwają datę na później. Ktoś, kto zaczął w 2010, miał " +
    "trzy lata przerwy i wrócił, osiąga dziesięć lat pracy w 2023, a nie w " +
    "2020. Przełącznik „Nadchodzące / Minione” wybiera połowę okna, obie " +
    "zaczynają się od dnia najbliższego dzisiaj. Liczymy tylko " +
    "opublikowane strony i tylko miejsca, o których wiemy, że należą do " +
    "sektora publicznego; pomijamy rady społeczne szpitali, bo za " +
    "zasiadanie w nich nikt nie płaci. Wygląd i przewijanie są takie jak w " +
    "„Ostatnich zatrudnieniach” na stronie głównej.",
  steps: [
    "Wejdź na /eksploruj/staz: ma być siatka kart, na desktopie dwie kolumny, przełącznik „Nadchodzące / Minione” z liczbami przy obu i podpis w rodzaju „26 osób z okrągłym stażem w najbliższym miesiącu”.",
    "Pierwsza karta ma być z dzisiaj albo z najbliższych dni - zielona belka z lewej i wyróżniona data. Ma tam być też zdanie, że daty w przyszłości zakładają pozostanie na stanowisku.",
    "Na karcie: „N lat pracy” przy nazwisku (łączny staż, nie staż na tym jednym stanowisku), stanowisko zajmowane tego dnia, i chip „w N instytucjach”. Liczba lat ma być całkowita.",
    "Znajdź kartę z chipem „z N okresów” - to osoba z przerwą w karierze. Wejdź na jej stronę i sprawdź, że data na karcie jest późniejsza niż rocznica pierwszego zatrudnienia, mniej więcej o długość przerwy.",
    "Kliknij „Minione”: lista ma się przeładować i zacząć od „wczoraj” albo najbliższego dnia wstecz, belki mają być szare, a w adresie ma się pojawić ?zakres=minione. Wróć na „Nadchodzące” - parametr znika.",
    "Przewiń w dół: dwie kolejne strony mają doładować się same, potem pojawia się przycisk „Pokaż więcej”. Po przełączeniu połowy licznik startuje od nowa.",
    "Nikt nie może pojawić się na liście dwa razy - kolejne okrągłe staże dzieli rok przepracowany, więc w oknie dwóch miesięcy mieści się najwyżej jeden.",
    "Link „Okrągły staż” jest w stopce, w sekcji „O projekcie”.",
  ],
  link: "/eksploruj/staz",
  area: "public",
} satisfies QaItem;
