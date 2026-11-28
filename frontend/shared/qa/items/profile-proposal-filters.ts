import type { QaItem } from "../../qa";

export const order = 17;

export default {
  id: "profile-proposal-filters",
  title: "Filtrowanie własnych propozycji, mniej niebieskiego",
  description:
    "Kafelki ze stanami na profilu nie tylko liczą propozycje - kliknięcie " +
    "zawęża listę do tego stanu, a ponowne kliknięcie ją przywraca. Nazwy " +
    "wpisów nie są już podkreślonymi, niebieskimi odnośnikami.",
  steps: [
    "Zaloguj się i wejdź na /profil, do sekcji „Twoje propozycje zmian”.",
    "Sprawdź nazwy wpisów na liście - mają być czarne jak reszta tekstu, podkreślają się dopiero pod kursorem.",
    "Kliknij kafelek „Oczekujące” - lista ma pokazać tylko oczekujące, a liczby na kafelkach mają zostać bez zmian.",
    "Kliknij ten sam kafelek jeszcze raz (albo „Pokaż wszystkie”) - wraca pełna lista.",
    "Kafelek ze stanem, w którym nic nie masz (np. „Odrzucone 0”), ma być wyszarzony i nieklikalny.",
    "Przy aktywnym filtrze „Zatwierdzone” sprawdź podpis pod kafelkami - ma uprzedzać, że są w nim też zastąpione.",
  ],
  link: "/profil",
  area: "contributor",
} satisfies QaItem;
