import type { QaItem } from "../../qa";

export const order = 141;

export default {
  id: "publish-relation-from-the-row",
  title: "Powiązanie można opublikować z wiersza, na którym stoi",
  description:
    "Powiązanie dodane między dwiema już opublikowanymi stronami dało się " +
    "opublikować tylko w kolejce /admin/krawedzie - kilkuset wierszach " +
    "ułożonych według identyfikatora, więc to dopiero co dodane było tam " +
    "najtrudniejsze do znalezienia. Teraz nieopublikowany wiersz nosi " +
    "odznakę „szkic”, a admin ma przy niej „Opublikuj”.",
  steps: [
    "Zaloguj się jako admin i wejdź na stronę opublikowanej osoby.",
    "Dodaj powiązanie do innej, też opublikowanej osoby.",
    "W „Historii powiązań” nowy wiersz ma mieć odznakę „szkic” i przycisk „Opublikuj” obok niej.",
    "Kliknij „Opublikuj” - odznaka ma zniknąć, a powiązanie ma być widoczne po wylogowaniu.",
    "Wejdź na stronę szkicu (osoby nieopublikowanej): jej wiersze mają nosić samą odznakę, bez przycisku - powiązania szkicu publikuje dialog „Opublikuj” przy nazwie strony.",
  ],
  area: "contributor",
} satisfies QaItem;
