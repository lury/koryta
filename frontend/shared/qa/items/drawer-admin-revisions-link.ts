import type { QaItem } from "../../qa";

export const order = 24;

export default {
  id: "drawer-admin-revisions-link",
  title: "Skrót do rewizji także w panelu bocznym",
  description:
    "Przycisk „Rewizje”, który admin ma na stronie osoby, jest teraz również " +
    "w panelu bocznym otwieranym z tabeli - w tej samej linii co „Zaproponuj " +
    "zmianę” i głosy. Nie trzeba już wychodzić z tabeli, żeby dojść do " +
    "ekranu, na którym stronę się publikuje.",
  steps: [
    "Jako admin wejdź na /eksploruj/tabela i kliknij nazwisko - w panelu, w linii z głosami, ma być przycisk „Rewizje”.",
    "Kliknij go - ma otworzyć listę rewizji tej samej osoby, którą panel pokazywał.",
    "Wróć do tabeli, otwórz inną osobę i sprawdź, że przycisk prowadzi do niej, a nie do poprzedniej.",
    "Zaloguj się jako zwykły użytkownik i powtórz - „Zaproponuj zmianę” ma być, „Rewizji” nie.",
  ],
  link: "/eksploruj/tabela",
  area: "admin",
} satisfies QaItem;
