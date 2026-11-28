import type { QaItem } from "../../qa";

export const order = 138;

export default {
  id: "home-timeline-panel",
  title: "Strona główna: „Partie” znika, „Wykres” wchodzi na jego miejsce",
  description:
    "Panel „Podział na partie” (mapa drzewa) został usunięty - był z tych " +
    "trzech najmniej używany. W jego miejsce jest „Wykres”: ile osób " +
    "zajmowało w danym miesiącu stanowisko opisane na koryta.pl. W panelu " +
    "po prawej wybiera się zakres czasu i podział - na partie, na " +
    "województwa albo na branże. Podział decyduje, czym jest jedna linia: " +
    "przy województwach linia „mazowieckie” liczy osoby ze stanowiskami w " +
    "tamtejszych instytucjach, przy branżach - osoby ze stanowiskami w " +
    "szpitalach, wodociągach i tak dalej. Linie, a nie słupki jedne na " +
    "drugich: kto pasuje do dwóch grup, liczy się w obu, więc linie się nie " +
    "sumują.",
  steps: [
    "Wejdź na stronę główną. Zakładki nad eksploratorem mają być dwie: „Mapa” i „Wykres”. „Partie” ma już nie być.",
    "Kliknij „Wykres”. Po prawej, w miejscu listy osób, ma się pokazać karta „Ustawienia wykresu” z zakresem czasu i podziałem.",
    "Zostaw podział „Partie”: PiS ma wyprzedzić PO w 2016 roku, dojść do szczytu w 2022 i spaść po 2024. Kolory linii mają być te same co żetony partii przy nazwiskach.",
    "Przełącz podział na „Województwa” - linii ma być osiem, w tym jedna szara „Pozostałe województwa”, a mazowieckie ma być najwyżej.",
    "Przełącz na „Branże” - w podpisie pod tytułem ma być widać, że branżę znamy tylko dla części stanowisk (mniej więcej 4 na 10).",
    "Przełączaj podział tam i z powrotem - wykres ma się przerysowywać od razu, bez ładowania.",
    "Zmień zakres na „5 lat” i „10 lat” - lata na dolnej osi mają się zmieniać razem z wykresem, a nie zostawać te same.",
    "Najedź myszą na dowolny miesiąc - chmurka ma wymienić wszystkie linie naraz, z polską nazwą miesiąca.",
    "Kliknij ikonę tabeli w prawym górnym rogu - te same liczby jako tabela, po jednym wierszu na rok, ostatni wiersz to bieżący miesiąc.",
    "Sprawdź marzec i kwiecień 2026 - linie mają iść dalej gładko. Gdyby w tym miejscu spadały o połowę, to błąd: w bazie jest 205 stanowisk z datą końca 2026-03-18, czyli datą zaciągnięcia danych, a nie datą odejścia.",
    "Zwęź okno do szerokości telefonu - zakładki mają być nad panelem, ustawienia pod wykresem, a przełącznik wykres/tabela ma zniknąć.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
