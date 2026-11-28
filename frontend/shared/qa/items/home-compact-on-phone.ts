import type { QaItem } from "../../qa";

export const order = 19;

export default {
  id: "home-compact-on-phone",
  title: "Strona główna na telefonie zaczyna się od wyszukiwarki",
  description:
    "Na wąskim ekranie strona główna nie otwiera się już logiem i nagłówkiem " +
    "na całe pierwsze przewinięcie - pierwsza jest wyszukiwarka. Znikają też " +
    "sekcja „Przeglądaj osoby” z dwoma kafelkami i przycisk „Albo zacznij " +
    "działać”, bo prowadzą tam, gdzie wyszukiwarka i „Działaj z nami”. Na " +
    "komputerze wszystko zostaje po staremu.",
  steps: [
    "Na telefonie (albo zwęź okno poniżej 960 px) wejdź na stronę główną - u góry ma być wyszukiwarka, bez logo i bez zdania „Jesteśmy największym…”.",
    "Sprawdź przycisk „Działaj z nami” pod wyszukiwarką - ma zaczynać się w tej samej linii co pole wyszukiwania, nie bardziej z lewej.",
    "Przewiń stronę - między mapą a sekcją „Zostało nam jeszcze dużo osób” nie ma już „Przeglądaj osoby” ani kafelków „Tabela powiązań” i „Przeglądaj nowe”.",
    "W sekcji „Zostało nam jeszcze dużo osób” ma być jeden przycisk „Chcę pomóc! (ankieta)”, bez „Albo zacznij działać”.",
    "Kliknij wyszukiwarkę i wybierz „Lista wszystkich osób” - tabela ma się otworzyć, mimo że kafelka do niej już nie ma.",
    "Rozszerz okno powyżej 960 px - logo, nagłówek, sekcja „Przeglądaj osoby” i drugi przycisk mają wrócić.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
