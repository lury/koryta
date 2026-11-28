import type { QaItem } from "../../qa";

export const order = 77;

export default {
  id: "porownanie-rewizji-da-sie-przewinac",
  title: "Porównanie rewizji da się przewinąć i zawęzić",
  description:
    "Na /admin/rewizje/<id> każda rewizja to osobna kolumna, więc węzeł, " +
    "który pipeline wgrywa co noc, rozjeżdżał się na kilka ekranów w bok. " +
    "Strona siedzi we flexowym kontenerze, a element flexa nie zwęża się " +
    "poniżej swojej treści - tabela rozpychała więc stronę zamiast się " +
    "przewijać, a `overflow-x: hidden` z Vuetify obcinał prawe kolumny bez " +
    "żadnego sposobu, żeby do nich dojechać. Teraz przewija się sama " +
    "tabela, a jej pasek stoi na dole okna zamiast na dole całej listy " +
    "pól. Nad tabelą doszły trzy filtry - wszystkie, od ludzi, oczekujące " +
    "- z licznikami, żeby dziesięć restartów pipeline'u nie stało między " +
    "recenzentem a propozycją, po którą przyszedł.",
  steps: [
    "Wejdź na /admin/rewizje i otwórz węzeł z dużą liczbą rewizji (kolumna „Rewizje łącznie”).",
    "Sprawdź, że strona nie rozjeżdża się w bok, a sama tabela ma poziomy pasek przewijania i da się nim dojechać do ostatniej kolumny.",
    "Przewiń tabelę w dół - poziomy pasek ma zostać widoczny, nie uciekać pod koniec listy pól.",
    "Kliknij „Od ludzi” - mają zostać tylko rewizje bez plakietki „Auto”, a licznik obok ma mówić, ile z ilu widać.",
    "Kliknij „Oczekujące” - ma zniknąć kolumna zatwierdzona i te odrzucone.",
    "Wejdź z kolejki /admin/rewizje/kolejka w „Pełne porównanie” konkretnej rewizji i włącz filtr, który by ją odciął - podświetlona kolumna ma zostać widoczna mimo filtra.",
  ],
  link: "/admin/rewizje",
  area: "admin",
} satisfies QaItem;
