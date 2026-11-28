import type { QaItem } from "../../qa";

export const order = 42;

export default {
  id: "notatki-do-poprawy-wymagaja-dzialania",
  title: "Zgłoszone poprawki i braki od razu trafiają na listę do zrobienia",
  description:
    "Notatka dodana jako „Do poprawy” albo „Brakuje danych” od razu liczy " +
    "się jako wymagająca działania w panelu admina - wcześniej pojawiała " +
    "się tam dopiero, gdy ktoś ręcznie oznaczył ją jako „Nierozwiązaną”, " +
    "więc zgłoszenia czytelników przepadały. Same źródła nadal wchodzą na " +
    "tę listę tylko z ręki admina, a oznaczenie „Rozwiązane” zdejmuje z " +
    "niej każdy wpis.",
  steps: [
    "Na dowolnej stronie osoby lub instytucji dodaj notatkę przyciskiem " +
      "„Opisz błąd” (albo „Zgłoś brak”) i zapisz ją.",
    "Wejdź na /admin - kafelek „Notatki wymagające działania” liczy nowe " +
      "zgłoszenie i pokazuje je na liście z chipem „Do poprawy”.",
    "Kliknij „Przejdź do notatek” - tabela otwiera się z filtrem " +
      "„Wymagające działania” i tym samym zestawem wierszy.",
    "Ustaw status wiersza na „Rozwiązane” i odśwież /admin - zgłoszenie " +
      "znika z kafelka.",
  ],
  link: "/admin",
  area: "admin",
} satisfies QaItem;
