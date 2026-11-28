import type { QaItem } from "../../qa";

export const order = 29;

export default {
  id: "graf-osoby-dwa-kroki",
  title: "Strona osoby przemeblowana, graf czytelniejszy",
  description:
    "Na stronie osoby kolejność sekcji odpowiada teraz temu, po co się na " +
    "nią wchodzi: najpierw historia powiązań, potem notatki, a graf na " +
    "końcu. Sam graf pokazuje domyślnie powiązania w dwóch krokach - nie " +
    "tylko tam, gdzie ta osoba pracowała, ale też z kim tam siedziała i " +
    "gdzie jeszcze siedzą tamci. Każdy węzeł ma ikonę mówiącą, czy to " +
    "osoba, instytucja czy region; nad płótnem jest legenda i przełącznik " +
    "zasięgu, a najechanie na węzeł wygasza wszystko, co z nim nie sąsiaduje.",
  steps: [
    "Wejdź na stronę osoby z wieloma powiązaniami (np. przez wyszukiwarkę wpisz nazwisko) i sprawdź kolejność: karta osoby, „Historia powiązań”, notatki, graf.",
    "W grafie porównaj węzły: osoba to kółko z sylwetką, instytucja to prostokąt z budynkiem, region to prostokąt z mapą. Legenda nad płótnem mówi to samo.",
    "Sprawdź, że osoba, której to strona, jest największa i ma obwódkę, a węzły drugiego kroku są mniejsze i bledsze.",
    "Najedź kursorem na dowolny węzeł - reszta grafu ma zblednąć, a podpisy zniknąć wszędzie poza jego sąsiadami.",
    "Kliknij węzeł raz: na pasku pod płótnem pojawia się jego nazwa z przyciskiem „Otwórz stronę”. Kliknij dwa razy: strona się otwiera.",
    "Przełącz zasięg na „1 krok” i z powrotem na „2 kroki” - graf ma się przerysować, a przy dużej liczbie dalszych powiązań pod płótnem pojawia się „Pominięto N dalszych powiązań”.",
  ],
  area: "public",
} satisfies QaItem;
