import type { QaItem } from "../../qa";

export const order = 14;

export default {
  id: "tabela-columns-on-phone",
  title: "Tabela na telefonie tylko z czterema kolumnami",
  description:
    "Na wąskim ekranie tabela „Eksploruj” pokazuje już tylko imię i " +
    "nazwisko, partie, firmy oraz wybory. Kolumny do eksploracji - " +
    "notatki, głosy, twój głos, widoczność i przyciski - znikają, bo " +
    "wszystko to jest w panelu, który otwiera się po kliknięciu nazwiska.",
  steps: [
    "Na telefonie (albo zwęź okno poniżej 960 px) wejdź na /eksploruj/tabela.",
    "Sprawdź, że w nagłówku są tylko „Imię i nazwisko”, „Partie”, „Firmy” i „Wybory”.",
    "Znajdź osobę z długą nazwą partii („Konfederacja”) - plakietka ma być ucięta wielokropkiem, a nie rozpychać kolumny.",
    "Sprawdź, że tabeli nie da się przewinąć w bok: żadna kolumna nie wystaje poza ekran.",
    "Kliknij nazwisko - panel ma się otworzyć od dołu, z głosami i notatkami tej osoby.",
    "Rozszerz okno powyżej 960 px - mają wrócić wszystkie kolumny, razem z „Głosy łącznie” i „Eksploruj”.",
    "Zaloguj się i powtórz to samo na wąskim ekranie - kolumny „Widoczność” też ma nie być.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
