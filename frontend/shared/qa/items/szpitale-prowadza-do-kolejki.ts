import type { QaItem } from "../../qa";

export const order = 72;

export default {
  id: "szpitale-prowadza-do-kolejki",
  title: "Strona szpitali prowadzi do kolejki, w której można pomóc",
  description:
    "Zestawienie rad nadzorczych szpitali mówi w podpisie wykresu, jak mała " +
    "część miejsc jest sprawdzona, i na tym się kończyło - czytelnik, który " +
    "chciał pomóc, nie miał gdzie kliknąć, a jedyną osobę, która się " +
    "zgłosiła, trzeba było ręcznie wysłać pod adres kolejki. Pod wykresem " +
    "jest teraz karta z liczbą osób czekających na sprawdzenie i przyciskiem " +
    "do kolejki zawężonej do szpitali. Karta mówi też wprost, że kolejka " +
    "jest zarazem samouczkiem.",
  steps: [
    "Wejdź na /eksploruj/szpitale i zjedź pod wykres i ramkę o radach społecznych.",
    "Karta „Pomóż uzupełnić te liczby” ma podawać liczbę osób czekających na sprawdzenie.",
    "Kliknij „Sprawdzaj osoby ze szpitali” - trafiasz na /eksploruj/nowe z ustawionym typem podmiotu „Szpitale”.",
    "Wyloguj się i kliknij ten sam przycisk - powinno przenieść na logowanie i po zalogowaniu wrócić do kolejki.",
    "Sprawdź drugi przycisk: „Cała lista w tabeli” otwiera /eksploruj/tabela zawężoną do szpitali.",
  ],
  link: "/eksploruj/szpitale",
  area: "public",
} satisfies QaItem;
