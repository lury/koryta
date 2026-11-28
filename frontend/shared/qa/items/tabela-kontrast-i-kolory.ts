import type { QaItem } from "../../qa";

export const order = 58;

export default {
  id: "tabela-kontrast-i-kolory",
  title:
    "Tabela eksploracji: czytelne kolory zamiast bladej zieleni, i kolor tylko tam, gdzie coś znaczy",
  description:
    "Zieleń i róż serwisu to kolory tła, a były używane jako kolor pisma: " +
    "nazwisko w tabeli, żeton filtru i przycisk „Pomóż sprawdzać” miały " +
    "kontrast 1,85:1 przy wymaganych 4,5:1, plakietka „szkic” 2,37:1, a " +
    "żeton Konfederacji czarny napis na granacie, czyli 1,29:1. Serwis ma " +
    "teraz drugą połowę palety: ciemne odcienie do pisania i blade do tła, " +
    "każdy zmierzony, więc każde zestawienie jest czytelne bez zgadywania. " +
    "Przy okazji strona wzięła trochę wyglądu strony podmiotu: zielone tło " +
    "pod nagłówkami kolumn, bladozieloną pigułkę z ikoną kalendarza na " +
    "dacie ostatniego zatrudnienia („od marca 2021” zamiast surowego „od " +
    "2019-03-01”) i nagłówki grup z licznikiem w panelu filtrów. Zieleni " +
    "jest przy tym tyle, ile coś mówi: zniknął pasek przy lewej krawędzi " +
    "paska filtrów i pasek przy lewej krawędzi każdego wiersza, bo " +
    "powtórzone w dziesięciu wierszach nie oddzielały niczego od niczego; " +
    "podświetlenie wiersza pod kursorem zostało, bo wskazuje ten jeden " +
    "wiersz. Nazwisko jest ciemnozielone i pogrubione, ale bez " +
    "podkreślenia - to nie jest odnośnik, tylko otwarcie panelu, więc " +
    "podkreślenie pojawia się dopiero pod kursorem. Przycisk otwierający " +
    "wyszukiwarki przestał być różowym kółkiem i jest znowu samą ikoną, " +
    "ciemną zamiast bladoróżowej: wypełnienie robiło z pomocniczej akcji " +
    "najgłośniejszy element wiersza, głośniejszy niż nazwisko obok. Kolor " +
    "niesie teraz znaczenie: zielone żetony mówią, czego tabela dotyczy, " +
    "niebieskie gdzie, szare zawężenia redakcyjne, bursztynowy „Tylko " +
    "szkice” i zielony „Tylko opublikowane” w tym samym kolorze co " +
    "plakietka na wierszach, które zostawiają - a ikonę ma z nich tylko " +
    "żeton kategorii, bo tylko jego napis („Szpitale”) sam nie mówi, czego " +
    "dotyczy.",
  steps: [
    "Wejdź na /eksploruj/tabela: nazwiska mają być ciemnozielone i pogrubione, a nie blade, i bez podkreślenia. Najedź kursorem na nazwisko - podkreślenie ma się pojawić dopiero wtedy.",
    "Ustaw filtr kategorii firm: żeton na pasku ma mieć wypełnione tło, ikonę sektora z lewej, a napis ma być czytelny, a nie w kolorze tła żetonu.",
    "Ustaw jeszcze filtr województwa i „Min. głosy”: te żetony mają być bez ikony, bo ich napisy („Region: ...”, „Min. 5 głosów”) same mówią, czego dotyczą. Ikonę ma tylko żeton kategorii.",
    "Ustaw filtr województwa i filtr kategorii naraz: żeton województwa ma być niebieski, a kategorii zielony, i mają się różnić na pierwszy rzut oka.",
    "Znajdź osobę z partią Konfederacja: napis na granatowym żetonie ma być biały, a nie czarny. PO ma mieć czarny napis na pomarańczowym, nie biały.",
    "Pod firmami: data ma stać w bladozielonej pigułce z ikoną kalendarza i brzmieć „od <miesiąc słownie> <rok>”, na przykład „od marca 2021”. Nigdzie nie może być surowej daty w rodzaju „od 2019-03-01”.",
    "Przesuń kursor po wierszach: wiersz ma się delikatnie podświetlać na zielono. Przy lewej krawędzi wiersza nie może stać zielony pasek - ani przy lewej krawędzi paska filtrów nad tabelą.",
    "Na szerokim ekranie sprawdź przycisk otwierający wyszukiwarki obok nazwiska: ma to być sama ciemna ikona, bez różowego kółka pod spodem, i ma być mniej widoczny niż nazwisko, obok którego stoi.",
    "Przewiń tabelę w dół na komputerze: nagłówki kolumn przyklejają się do góry i mają mieć bladozielone tło, przez które nie prześwitują przejeżdżające pod nimi wiersze.",
    "Zaloguj się i ustaw „Widoczność: Tylko szkice”: żeton filtru ma być bursztynowy, w tym samym kolorze co plakietki „szkic” przy nazwiskach. Po przełączeniu na „Tylko opublikowane” żeton ma być zielony.",
    "Zalogowany sprawdź kolumnę „Twój głos”: po oddaniu głosu na plus liczba i strzałka mają być ciemnozielone, a nie jasne, i tak samo czerwone na minus.",
    "Otwórz „Filtry”: nad każdą grupą ma być mała etykieta („Osoba i podmiot”, „Weryfikacja”, „Więcej filtrów”), a po prawej liczba ustawionych w niej filtrów, na przykład „2 filtry”. Grupa, w której nic nie ustawiono, nie ma liczby.",
    "W „Więcej filtrów” wybierz kilka partii: żetony w polu wyboru mają mieć kolory partii, te same co przy nazwiskach w tabeli. Wybierz partię, dla której serwis nie ma koloru (np. Razem): ma być szara z czytelnym napisem, a nie ciemna.",
    "Kliknij przycisk udostępniania: zdanie opisujące widok ma stać na bladozielonym tle z ikoną filtru, a oba przyciski kopiowania mają mieć ikony.",
    "Ustaw filtr województwa i nie ustawiaj żadnej firmy: pod tabelą pojawia się apel o zrzutkę. Jego tekst ma być czytelny i ciemny, a nie pomarańczowy na pomarańczowym tle.",
    "Wyloguj się i wejdź na /eksploruj/tabela: nad tabelą stoi niebieski baner „Zaloguj się...”. Jego tekst, pogrubiona liczba i ikona mają być ciemnoniebieskie, a nie blade.",
    "Kliknij nazwisko i w panelu sprawdź przycisk „Zaproponuj zmianę”: napis ma być ciemnobursztynowy na jasnym tle, a nie pomarańczowy na pomarańczowym. Po wysłaniu zmiany odnośnik „Podgląd zmiany” w potwierdzeniu ma być podkreślony i w tym samym ciemnym niebieskim co zdanie obok.",
    "Otwórz „Filtry” i wybierz cokolwiek w polu z listą: nazwa pola, która przeskakuje nad wybraną wartość, ma być czytelną szarością, a nie bladoszara.",
    "Zmruż oczy albo ustaw w systemie skalę szarości i przejrzyj całą stronę: nigdzie nie może zostać napisu, który znika z tła. To jest test, który zgłoszenie opisywało.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
