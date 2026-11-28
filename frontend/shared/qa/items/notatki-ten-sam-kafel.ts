import type { QaItem } from "../../qa";

export const order = 91;

export default {
  id: "notatki-ten-sam-kafel",
  title: "Notatki są takimi samymi kafelkami jak reszta strony",
  description:
    "Sam nagłówek „Notatki” to było za mało: pojedyncza notatka wciąż " +
    "wyglądała jak niewypełniony formularz - tekst siedział w polu do " +
    "wpisywania, nad nim wisiało szare pytanie do autora („Czego tu " +
    "brakuje?”), a litery były dwa razy większe niż w sekcjach obok. Teraz " +
    "notatka to zwykły kafelek - biała, cienka ramka, zaokrąglone rogi i " +
    "zielona krawędź po lewej - dokładnie taki sam jak karty w „Zmianach na " +
    "stanowisku” i na stronie spółki, bo wszystkie rysuje już jedna reguła " +
    "zamiast pięciu przepisanych ręcznie kopii. Pole do pisania pojawia się " +
    "dopiero wtedy, gdy sam edytujesz swoją notatkę. Adres źródła jest " +
    "podpisany nazwą serwisu zamiast uciętego w pół linku, a notatki idą " +
    "jedna pod drugą na całą szerokość, jak powiązania nad nimi.",
  steps: [
    "Wejdź zalogowany na stronę osoby, która ma notatki, np. /osoba/marzena-slomka-a8sCGsKrCC6OyVDmkOeg. Notatki mają być zwykłym tekstem - żadnej ramki pola do wpisywania, żadnego szarego pytania nad tekstem.",
    "Porównaj kafelek notatki z kartą w sekcji „Zmiany na stanowisku” nad nią: ta sama ramka, to samo zaokrąglenie rogów, ta sama zielona krawędź po lewej i ta sama wielkość liter.",
    "Najedź myszką na notatkę - ramka ma zzielenieć i pojawić się delikatny cień, tak samo jak przy najechaniu na kartę zmiany na stanowisku.",
    "Sprawdź adres źródła: ma być podpisany nazwą serwisu (np. „wyborcza.pl”), a nie uciętym w połowie długim linkiem. Kliknięcie otwiera oryginał w nowej karcie.",
    "Zwróć uwagę, że nagłówki „Historia powiązań”, „Zmiany na stanowisku”, „Notatki” i „Fakty z artykułów” zaczynają się teraz w jednej linii, jeden pod drugim.",
    "Kliknij „Opisz błąd”, wpisz treść i zapisz. Dopiero w trybie edycji ma być widoczne pole do pisania razem z pytaniem pomocniczym; po zapisaniu wraca zwykły tekst.",
    "Kliknij „Edytuj”, potem „Anuluj” - notatka ma wrócić do poprzedniej treści.",
    "Trzy przyciski dodawania („Dodaj źródło”, „Opisz błąd”, „Zgłoś brak”) mają być w jednym rzędzie i bez kolorowych obwódek, tak jak „Dodaj” w „Historii powiązań”.",
    "To samo sprawdź na stronie spółki (/instytucja/...), artykułu i tematu, w panelu bocznym otwieranym z /eksploruj/tabela oraz na /eksploruj/nowe - notatki rysuje wszędzie ten sam komponent.",
    "Na telefonie: notatki mają iść jedna pod drugą na całą szerokość, tak jak powiązania nad nimi.",
  ],
  link: "/osoba/marzena-slomka-a8sCGsKrCC6OyVDmkOeg",
  area: "public",
} satisfies QaItem;
