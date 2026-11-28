import type { QaItem } from "../../qa";

export const order = 67;

export default {
  id: "strona-ktora-jest-dwiema-osobami",
  title: "Stronę, która okazała się dwiema osobami, można rozdzielić",
  description:
    "Odwrotny problem do duplikatu i trudniejszy: przy dwóch osobach o tym " +
    "samym imieniu, nazwisku i roczniku pipeline traktował je jak jedną, a " +
    "powiązania nie zapisują, z którego wpisu w rejestrze pochodzą - więc " +
    "żadne zapytanie nie powie, czyja jest która posada. Może to powiedzieć " +
    "tylko człowiek, dlatego rozdzielenie polega na zaznaczeniu powiązań " +
    "należących do tej drugiej osoby. Można je przenieść na stronę utworzoną " +
    "wcześniej ręcznie albo od razu założyć nową. Ponieważ zauważenie " +
    "problemu i rozplątanie go to zwykle dwa różne dni, stronę można też " +
    "najpierw tylko oznaczyć - wtedy admin widzi na niej pasek, że to dwie " +
    "osoby, razem z powodem i tym, kto to zgłosił. Powiązania niezaznaczone " +
    "zostają tam, gdzie były.",
  steps: [
    "Jako admin otwórz osobę, co do której wiadomo, że łączy dwie (np. częste imię i nazwisko z posadami w dwóch odległych miejscach), i wybierz „Ta strona to dwie osoby”.",
    "Użyj „Zaznacz do rozdzielenia” z powodem. Odśwież stronę - ma być widoczny pasek z powodem i autorem zgłoszenia.",
    "Wróć do okna, wybierz „Rozdziel teraz”, zaznacz powiązania drugiej osoby i wpisz jej imię.",
    "Sprawdź podsumowanie przed potwierdzeniem, potwierdź, a potem otwórz nową stronę - ma mieć dokładnie zaznaczone powiązania i być szkicem do publikacji.",
    "Wróć na pierwotną stronę: pasek „to dwie osoby” ma zniknąć, a niezaznaczone powiązania zostać.",
  ],
  area: "admin",
} satisfies QaItem;
