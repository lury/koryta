import type { QaItem } from "../../qa";

export const order = 56;

export default {
  id: "tabela-pasek-zapytania",
  title: "Tabela eksploracji: jeden pasek zamiast ekranu filtrów",
  description:
    "Na /eksploruj/tabela pierwszy wiersz danych zaczynał się 697 pikseli " +
    "od góry na komputerze i 588 na telefonie - wcześniej były tam trzy " +
    "linijki tytułu, sześć zawsze otwartych list filtrów i karta z " +
    "postępem. Teraz jest jeden pasek: tytuł, przycisk „Filtry” z liczbą " +
    "aktywnych filtrów, żeton dla każdego filtru, który zawęża tabelę, " +
    "liczba osób, sortowanie i przycisk udostępniania. Zalogowany dostaje " +
    "pod nim drugą linijkę z postępem sprawdzania, swoim wkładem i " +
    "skrótami do czterech najczęściej używanych filtrów weryfikacji. " +
    "Kolumny są scalone: „Firmy” niosą datę ostatniego zatrudnienia i " +
    "staż („od marca 2021” i „11 lat pracy”), „Oceny” liczbę notatek, a " +
    "„Lata pracy” i „Notatki” przeniosły się do menu sortowania w " +
    "nagłówkach tych kolumn - obie liczby są więc nadal w wierszu, po " +
    "którym się sortuje. Kolumna „Eksploruj” " +
    "zniknęła - lupa robiła to samo co kliknięcie w nazwisko, a przycisk " +
    "wyszukiwarek stoi teraz obok nazwiska. Baner logowania, " +
    "apel o zrzutkę i lista wybranych firm są pod tabelą.",
  steps: [
    "Wejdź na /eksploruj/tabela wylogowany: nad tabelą ma być tylko jeden pasek z nagłówkiem „Powiązania osób i spółek publicznych”, a pierwsze nazwisko widoczne bez przewijania.",
    "Kliknij „Filtry”, wybierz kategorię i zamknij panel - na pasku ma przybyć żeton z nazwą kategorii, a licznik przy przycisku ma pokazać „Filtry (1)”.",
    "Kliknij x na tym żetonie: filtr znika z paska i z adresu strony, a liczba osób obok się zmienia.",
    "Ustaw kilka filtrów naraz i sprawdź, że żetony zawijają się do drugiej linijki zamiast chować się poza ekranem; potem kliknij „Wyczyść” - mają zniknąć wszystkie za jednym razem.",
    "Kliknij nagłówek kolumny „Firmy”, a potem otwórz jego menu i wybierz sortowanie po latach pracy - tabela ma się przeładować i nie może być pusta, a pod firmami mają stać dwa podpisy z ikonami: „od marca 2021” i „N lat pracy”, czyli liczba, po której właśnie posortowałeś.",
    "To samo w kolumnie „Oceny”: menu ma dawać sortowanie po sumie ocen i po liczbie notatek, a pod sumą ocen ma być podpis „N notatek”. Wiersz bez notatek ma zostać jednolinijkowy.",
    "Sprawdź przycisk sortowania na pasku: na świeżo otwartej tabeli ma pisać „Sortowanie” bez strzałki, a po wybraniu sortowania skróconą nazwę („Zatrudnienie”, „Oceny”, „Notatki”) i strzałkę kierunku.",
    "Otwórz ręcznie stary link /eksploruj/tabela?sortBy=latestEmploymentStart&sortDesc=true - tabela ma się wypełnić danymi, a nie pokazać „Brak danych”.",
    "Kliknij przycisk udostępniania po prawej stronie paska i sprawdź, że skopiowany adres po wklejeniu w nowej karcie odtwarza ten sam zestaw filtrów.",
    "Przejdź na drugą stronę wyników i otwórz udostępnianie ponownie: ma się pojawić pole „Dołącz stronę i liczbę wierszy”. Odznaczone - link prowadzi na pierwszą stronę; zaznaczone - adres dostaje page=2. Na pierwszej stronie i przy domyślnej liczbie wierszy tego pola nie ma, bo nie miałoby czego dodać.",
    "Zaloguj się: pod paskiem ma się pojawić druga linijka z paskiem postępu i zdaniem „sprawdzono X z Y osób”, „Twój wkład” w tej samej linijce i czterema skrótami: „+ Widoczność”, „+ Bez ocenionych”, „+ Od kiedy”, „+ Min. głosy”.",
    "Kliknij „+ Bez ocenionych”: lista, która się otworzy, ma mieć pozycję o dokładnie tej samej nazwie („Bez ocenionych”), a po jej wybraniu na wierszu ma zostać żeton „bez ocenionych”. Tak samo „+ Widoczność” i jej „Tylko szkice”.",
    "Kliknij „+ Min. głosy”, ustaw 5 - ma powstać żeton „min. 5 głosów”; kliknij w jego środek, żeby zmienić wartość na 10 bez czyszczenia filtru.",
    "Zwęź okno do szerokości telefonu (390px): mają zostać dwie kolumny - „Osoba” i „Firmy” - liczba osób ma nadal być widoczna na pasku, suma ocen ma się pokazać jako podpis pod nazwiskiem, i nie może być poziomego przewijania.",
    "Nadal na telefonie: przycisk sortowania ma mieć widoczną nazwę - to jedyne miejsce, z którego można tam sortować, bo nagłówki „Oceny” i „Wybory” są schowane - a plakietki wyborów mają wrócić do komórki „Firmy”, gdzie na komputerze jest ich osobna kolumna.",
    "Przewiń na sam dół strony: baner logowania (dla wylogowanego), apel o zrzutkę i lista wybranych firm mają być pod tabelą, w tej kolejności.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
