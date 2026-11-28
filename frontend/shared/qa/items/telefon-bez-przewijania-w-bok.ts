import type { QaItem } from "../../qa";

export const order = 78;

export default {
  id: "telefon-bez-przewijania-w-bok",
  title: "Strony przestały uciekać w bok na telefonie",
  description:
    "Pod „Pomóż uzupełnić te liczby” na stronie rad szpitali stały obok " +
    "siebie dwa przyciski, których napisy razem potrzebują 424 pikseli, a " +
    "telefon daje 311 - a przycisk nigdy nie łamie swojego napisu. Strona " +
    "nie tyle wystawała poza ekran, co się do tego rzędu rozciągnęła: 502 " +
    "piksele zamiast 375, więc każda karta na niej była za szeroka i całość " +
    "dało się przesuwać palcem w bok. Przyciski stoją teraz na telefonie " +
    "jeden pod drugim, a od szerokości tabletu wracają obok siebie. Samo " +
    "rozciąganie naprawione jest raz dla wszystkich stron, bo brało się z " +
    "układu wspólnego dla całego serwisu - na /eksploruj/statystyki robiło " +
    "z 375-pikselowego telefonu dokument szeroki na 382 piksele, choć nic " +
    "na tej stronie nie było przycięte.",
  steps: [
    "Otwórz /eksploruj/szpitale na telefonie (albo w trybie urządzenia mobilnego, 375px) i spróbuj przesunąć stronę palcem w bok - nie ma drgnąć.",
    "W karcie „Pomóż uzupełnić te liczby” przyciski „Sprawdzaj osoby ze szpitali” i „Cała lista w tabeli” mają być jeden pod drugim, każdy na całą szerokość karty.",
    "Rozszerz okno powyżej 600 pikseli - te same przyciski wracają obok siebie.",
    "Oba prowadzą tam, gdzie wcześniej: pierwszy do kolejki szpitali, drugi do tabeli przefiltrowanej na szpitale.",
    "To samo sprawdź na /eksploruj/statystyki i /zrodla - żadna z nich nie ma się przesuwać w bok, a karty mają kończyć się na krawędzi ekranu.",
  ],
  link: "/eksploruj/szpitale",
  area: "public",
} satisfies QaItem;
