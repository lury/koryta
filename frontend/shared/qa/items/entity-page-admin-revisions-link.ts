import type { QaItem } from "../../qa";

export const order = 20;

export default {
  id: "entity-page-admin-revisions-link",
  title: "Skrót do rewizji i publikacji ze strony osoby",
  description:
    "Admin na stronie osoby wchodzi wprost na jej listę rewizji, gdzie " +
    "stronę się publikuje, zamiast szukać jej po id w /admin/rewizje. " +
    "Przycisk stoi pod ołówkiem i oceną, razem z resztą tego, co można na " +
    "tej stronie zrobić.",
  steps: [
    "Jako admin wejdź na /eksploruj/tabela i kliknij dowolną osobę.",
    "Przy nazwisku, pod przyciskiem edycji i oceną, kliknij „Rewizje i publikacja” - ma otworzyć listę rewizji tej właśnie osoby.",
    "Sprawdź na górze tamtej strony, czy osoba jest opublikowana, i w razie potrzeby opublikuj ją.",
    "Wróć na stronę osoby i sprawdź, że przycisk prowadzi tam samo.",
    "Wyloguj się (albo zaloguj jako zwykły użytkownik) i otwórz tę samą stronę - przycisku ma nie być.",
    "Zwęź okno poniżej 960 px - przycisk chowa się razem z edycją i oceną, tak jak one.",
  ],
  link: "/eksploruj/tabela",
  area: "admin",
} satisfies QaItem;
