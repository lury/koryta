import type { QaItem } from "../../qa";

export const order = 63;

export default {
  id: "szpitale-na-telefonie",
  title:
    "Szpitale na telefonie: wykres od razu, bez wstępu i bez kolumn dla redakcji",
  description:
    "Strona nie mieściła się na telefonie - trzeba było ją oddalić, żeby " +
    "cokolwiek przeczytać. Wiersz wykresu miał pięć kolumn i przy " +
    "najwęższym ustawieniu i tak potrzebował 446 px, a w karcie na " +
    "ekranie 375 px jest ich około 310. Poniżej progu „sm” zostają trzy " +
    "kolumny: nazwa, słupek i liczba znalezionych miejsc. Znikają dwie " +
    "redakcyjne - „do sprawdzenia” i „kolejka pracy” - bo wybierania " +
    "sobie następnej partii osób do sprawdzenia nikt nie robi na " +
    "telefonie. Z tego samego powodu znika na telefonie przełącznik " +
    "wykres/tabela: dwie ikony obok tytułu łamały go na trzy linijki, " +
    "czyli kosztowały ekran wysokości. Znika wreszcie szary ogon słupka - " +
    "zaległość z rejestru - bo to ta sama redakcyjna połowa wykresu co " +
    "kolumna i przycisk, a na telefonie zajmowała większość tuszu wiersza. " +
    "Na telefonie nie ma więc dojścia do tabeli ani do żadnej liczby " +
    "zaległości - wszystko to jest dla tej samej osoby przy biurku. " +
    "Skoro ogona nie ma, słupki są na telefonie mierzone do najdłuższego " +
    "wiersza ZNALEZIONEGO, a nie do tego, co wiadomo z KRS: inaczej każdy " +
    "słupek siedziałby w torze, którego większość jest pusta i nic nie " +
    "mówi, dlaczego. Skala dalej jest wspólna dla wszystkich wierszy i " +
    "żaden nie jest skalowany osobno, więc wiersze wciąż da się " +
    "porównywać - podpis nad wykresem mówi, do czego. " +
    "Do tego wykres wychodzi na samą górę strony: pięć kafelków, pasek " +
    "organów nadzoru i notka o radach społecznych to kontekst do jego " +
    "czytania, a nie wejście, a na telefonie były trzema ekranami " +
    "wstępu przed pierwszym słupkiem. Teraz stoją pod wykresem, w tej " +
    "samej kolejności co wcześniej. Nad wykresem nie ma już akapitu " +
    "wstępu ani nagłówka „Podział na partie” - obydwa powtarzały to, co " +
    "mówi tytuł karty i notka pod nią, a nagłówek przestał być prawdziwy, " +
    "gdy wykres dostał podział na województwa i szpitale. Zniknął też " +
    "przycisk „Statystyki bazy”: prowadził na stronę redakcyjną, a nie " +
    "tam, gdzie idzie czytelnik tej. Sama strona przestała wreszcie " +
    "dokładać 16 px marginesu do tego, który ma już kontener.",
  steps: [
    "Otwórz /eksploruj/szpitale na telefonie (albo w oknie 375 px szerokości).",
    "Strona nie ma się przewijać na boki i nie ma wymagać oddalenia - żaden element nie wystaje poza ekran.",
    "Pod nagłówkiem „Rady nadzorcze szpitali publicznych” nie ma akapitu wstępu ani przycisku „Statystyki bazy” - od razu jest przełącznik rady nadzorcze / rady społeczne i wykres. Kafelki „W skrócie” są dopiero pod nim.",
    "Nie ma nagłówka „Podział na partie”. Kartę tytułuje sam wykres, zgodnie z wybranym podziałem.",
    "Wiersz wykresu ma nazwę, słupek i jedną liczbę. Nie ma kolumny „do sprawdzenia” ani przycisku „Zobacz osoby” / „Zaloguj się”.",
    "Słupek jest w całości kolorowy - nie ma za nim szarego ogona, a w legendzie nie ma pozycji „osoby z rejestru, jeszcze niesprawdzone”.",
    "Najdłuższy słupek sięga końca toru. Podpis nad wykresem ma podawać skalę „do N sprawdzonych miejsc” i mówić, że zaległości na wąskim ekranie nie rysujemy.",
    "W prawym górnym rogu karty nie ma pary ikon wykres/tabela, a tytuł karty nie łamie się przez nie na trzy linijki.",
    "Rozszerz okno powyżej 600 px: mają wrócić obie kolumny, przycisk kolejki, szary ogon, jego pozycja w legendzie i przełącznik wykres/tabela. Skala nad wykresem ma wrócić do „miejsc znanych z KRS”, a słupki - skrócić. Po przełączeniu na tabelę kolumna „Do sprawdzenia” ma tam być, a tabela ma się przewijać w poziomie w swojej ramce, nie razem ze stroną.",
    "Notka „Rada społeczna to nie rada nadzorcza” stoi pod wykresem i mówi o przełączniku „nad wykresem” - sprawdź, że wskazuje na ten, który faktycznie jest wyżej.",
    "Wejdź na /eksploruj/statystyki na telefonie: tam przełącznik wykres/tabela ma zostać - zniknął tylko na wykresie szpitali.",
  ],
  link: "/eksploruj/szpitale",
  area: "public",
} satisfies QaItem;
