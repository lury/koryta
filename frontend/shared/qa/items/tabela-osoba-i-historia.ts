import type { QaItem } from "../../qa";

export const order = 52;

export default {
  id: "tabela-osoba-i-historia",
  title: "Tabela: osoba i jej historia w dwóch kolumnach",
  description:
    "W tabeli „Eksploruj” imię i partie są teraz jedną kolumną „Osoba”, a " +
    "firmy, data ostatniego zatrudnienia i wybory drugą - „Historia”. Na " +
    "telefonie zostają dwie szerokie kolumny zamiast czterech wąskich, " +
    "więc plakietka partii nie jest już ucięta po sześciu literach ani " +
    "nazwa firmy po ośmiu. Sortowanie po dacie ostatniego zatrudnienia " +
    "siedzi od teraz na nagłówku „Historia” i jest wreszcie dostępne z " +
    "telefonu, a stare linki z ?sortBy=latestEmploymentStart działają " +
    "dokładnie jak dotąd.",
  steps: [
    "Wejdź na /eksploruj/tabela - w nagłówku mają być „Osoba” i „Firmy” zamiast „Imię i nazwisko”, „Partie” i osobnej kolumny z datą (kolumna scalona nazywała się „Historia” do czasu paska zapytania).",
    "Sprawdź kolumnę „Osoba”: plakietki partii mają stać obok nazwiska albo pod nim, a nie w osobnej kolumnie.",
    "Sprawdź kolumnę „Firmy”: mają w niej być plakietki firm, a pod nimi data ostatniego zatrudnienia. Plakietki wyborów stoją na komputerze w osobnej kolumnie „Wybory”, a poniżej 960 px wracają do tej samej komórki.",
    "Najedź na plakietkę firmy i na plakietkę wyborów - dymki z pełną nazwą firmy oraz z okręgiem, województwem i komitetem mają działać jak wcześniej.",
    "Zwęź okno poniżej 960 px albo wejdź z telefonu - kolumny mają być dwie, nazwa partii ma się mieścić w całości albo być ucięta dopiero na szerokości kolumny, a tabeli nie da się przewinąć w bok.",
    "Nadal na wąskim ekranie: pod firmami mają być lata pracy, bo osobnej kolumny na nie tu nie ma - od czasu kolorów partii jako dwa podpisy z ikonami, „od marca 2021” i „N lat pracy”, a nie jeden „od <data> · N lat pracy”.",
    "Kliknij nagłówek „Firmy” - tabela ma się posortować, a w adresie ma się pojawić sortBy=latestEmploymentStart.",
    "Zalogowany wejdź na /eksploruj/tabela?sortBy=latestEmploymentStart&sortDesc=true - lista ma się załadować (nie może być pusta), a strzałka sortowania ma stać przy „Firmach”.",
    "Kliknij nazwisko - w szufladzie mają być te same partie, firmy i wybory, w pełnej postaci.",
    "Rozszerz okno powyżej 960 px - obok tych dwóch kolumn mają wrócić „Wybory”, „Oceny” i „Twój głos”. „Lata pracy” i „Notatki” są od czasu paska zapytania pozycjami w menu sortowania nagłówków „Firmy” i „Oceny”, a nie kolumnami; kolumny „Eksploruj” nie ma wcale.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
