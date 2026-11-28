import type { QaItem } from "../../qa";

export const order = 57;

export default {
  id: "tabela-kolory-partii-i-szkic",
  title:
    "Tabela eksploracji: kolory partii, krótszy podpis pod firmami, „szkic” przy nazwisku",
  description:
    "Cztery poprawki po przeglądzie scalonych kolumn. Żetony partii mają " +
    "kolory partii - rysuje je ten sam komponent co profile, szuflada i " +
    "statystyki, więc ta sama partia nie jest już szara w tabeli, a " +
    "kolorowa wszędzie indziej; partia, dla której serwis nie ma koloru, " +
    "dostaje szarą plakietkę zamiast gołego tekstu. Podpis pod firmami " +
    "stracił etykietę „Ostatnie zatrudnienie:” i datę dzienną: są dwie " +
    "ikony, kalendarz z miesiącem i rokiem („od marca 2021”) oraz teczka ze " +
    "stażem („11 lat pracy”), każda z opisem po najechaniu. Staż jest " +
    "zaokrąglony do pełnych lat, bo wcześniej wychodziło „12.4 lat pracy”: " +
    "z kropką zamiast przecinka i z „lat” tam, gdzie po ułamku powinno stać " +
    "„roku”. Staż krótszy niż rok pisze się jako „poniżej roku”, a nie „0 " +
    "lat pracy”, i to samo zaokrąglenie obowiązuje teraz w kolumnie „Lata " +
    "pracy” na /eksploruj/nowe, gdzie do tej pory wciąż stała liczba z " +
    "kropką. " +
    "Dymek przy przycisku wyszukiwarek pojawia się po 0,2 sekundy " +
    "zamiast po dwóch - ostrzeżenie, że kliknięcie otwiera naraz wiele " +
    "kart, nie miało dotąd szans się pokazać. Kolumna „Widoczność” " +
    "zniknęła: nieopublikowana osoba ma plakietkę „szkic” przy nazwisku, " +
    "przy opublikowanej nie ma nic, bo to ona jest regułą, a sortowanie po " +
    "statusie zostało w menu sortowania na pasku.",
  steps: [
    "Wejdź na /eksploruj/tabela: żetony partii przy nazwiskach mają mieć kolory partii - PiS granatowy z białym napisem, PO pomarańczowy - takie same jak na stronie osoby.",
    "Znajdź osobę z partią, dla której serwis nie ma koloru (np. Razem): ma mieć szarą plakietkę, a nie sam napis na białym tle.",
    "Pod firmami mają być dwa podpisy z ikonami: kalendarz z „od <miesiąc słownie> <rok>” i teczka z „N lat pracy”. W samym wierszu nie może być już napisu „Ostatnie zatrudnienie:”, daty w rodzaju 2021-03-01 ani liczby z kropką („12.4 lat pracy”) - „Ostatnie zatrudnienie” zostaje tylko jako nazwa sortowania w menu.",
    "Najedź kursorem na każdy z tych podpisów - przeglądarka ma pokazać, co dana ikona znaczy: początek ostatniego zatrudnienia i łączny staż.",
    "Najedź na przycisk wyszukiwarek obok nazwiska (ikona otwierania w nowej karcie): dymek „Otwiera wiele kart wyszukiwania jednocześnie...” ma się pokazać od razu, a nie po dwóch sekundach nieruchomego kursora.",
    "Zaloguj się i ustaw „Widoczność: Tylko szkice”: kolumny „Widoczność” nie ma, a przy każdym nazwisku stoi mała plakietka „szkic”. Po przełączeniu na „Tylko opublikowane” nie ma żadnej plakietki - i tak ma być.",
    "Zalogowany otwórz menu sortowania na pasku: ma tam nadal być „Status”. Wybierz je - tabela ma się przeładować i nie może być pusta. Wylogowany tej pozycji nie ma.",
    "Otwórz zalogowany link /eksploruj/tabela?sortBy=visibility&sortDesc=true - lista ma się załadować, mimo że nie ma już nagłówka, w który dałoby się kliknąć.",
    "Zwęź okno do 390px: oba podpisy pod firmami mają się zmieścić bez poziomego przewijania, a długa nazwa partii ma zostać ucięta wielokropkiem, zamiast rozpychać kolumnę z nazwiskiem.",
    "Zaloguj się i otwórz /eksploruj/nowe: w kolumnie „Lata pracy” ma stać sama liczba całkowita („12”), nigdzie nie może być kropki ani części dziesiętnej. Klikaj „Następna osoba” kilka razy - osoba z krótkim stażem ma mieć „poniżej roku”, a osoba bez znanego zatrudnienia pustą komórkę, nie „0”.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
