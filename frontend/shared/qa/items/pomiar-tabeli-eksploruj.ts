import type { QaItem } from "../../qa";

export const order = 95;

export default {
  id: "pomiar-tabeli-eksploruj",
  title: "Wiemy, co ludzie robią w tabeli",
  description:
    "Tabela jest drugą najczęściej otwieraną stroną, ale trzech na " +
    "czterech czytelników, którzy na niej zaczynają, wychodziło bez śladu " +
    "- filtry, sortowanie i przewijanie stron zmieniają tylko adres, więc " +
    "dla statystyk wyglądały jak nic. Teraz każde z nich się liczy. " +
    "Wygląd i działanie strony bez zmian.",
  steps: [
    "Wejdź na /eksploruj/tabela, ustaw filtr partii, posortuj kolumnę i przejdź na drugą stronę wyników - wszystko ma działać jak dotąd.",
    "Kliknij nazwisko: ma się otworzyć panel boczny osoby.",
    "Kliknij „Wyczyść” - wszystkie filtry znikają naraz.",
    "Skopiuj link z karty udostępniania i sprawdź, że otwiera tę samą przefiltrowaną tabelę.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
