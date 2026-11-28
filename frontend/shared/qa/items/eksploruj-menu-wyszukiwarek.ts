import type { QaItem } from "../../qa";

export const order = 98;

export default {
  id: "eksploruj-menu-wyszukiwarek",
  title: "„Eksploruj” na stronie osoby to menu, a nie osiem kart naraz",
  description:
    "Przycisk otwierał od razu wszystkie wyszukiwania - rejestr.io, " +
    "Wikipedię i zapytania Google dla każdego miasta - więc sprawdzenie " +
    "jednej rzeczy kończyło się zamykaniem siedmiu kart. Teraz rozwija " +
    "listę, z której można wybrać jedno wyszukiwanie; „Otwórz wszystkie” " +
    "zostało na górze listy razem z ostrzeżeniem o blokadzie okienek. " +
    "Pozycje są zwykłymi linkami, więc działa na nich środkowy przycisk " +
    "myszy i „kopiuj adres”. Przycisk w tabeli eksploracji zostaje bez " +
    "zmian - tam ogląda się osobę, której się jeszcze nie zna.",
  steps: [
    "Jako admin wejdź na stronę osoby i kliknij ikonę „Eksploruj” obok nazwiska.",
    "Wybierz jedno wyszukiwanie - otwiera się jedna karta.",
    "Otwórz menu ponownie i kliknij „Otwórz wszystkie” - zachowanie jak wcześniej.",
    "Sprawdź, że pozycja z Google ma adres do skopiowania (prawy przycisk myszy).",
  ],
  area: "admin",
} satisfies QaItem;
