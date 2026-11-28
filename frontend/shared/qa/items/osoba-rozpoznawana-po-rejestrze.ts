import type { QaItem } from "../../qa";

export const order = 69;

export default {
  id: "osoba-rozpoznawana-po-rejestrze",
  title: "Upload rozpoznaje osobę po wpisie w rejestrze, nie po imieniu",
  description:
    "Pipeline nie ma jednego, stałego zapisu czyjegoś imienia - raz przysyła " +
    "„Andrzej Golimont”, raz „Andrzej Marcin Golimont”, bo wybiera je z listy, " +
    "której kolejność nie jest ustalona. Upload porównywał dokładnie ten " +
    "napis, więc druga pisownia zakładała drugą stronę: tak powstało 170 par " +
    "stron opisujących jedną osobę. W drugą stronę było gorzej - dwóch " +
    "różnych ludzi o tym samym imieniu i nazwisku trafiało na jedną stronę, a " +
    "drugi z nich nadpisywał pierwszemu odnośnik do rejestru. Teraz upload " +
    "szuka najpierw po wpisie w rejestr.io, który jest jeden na człowieka. Po " +
    "imieniu dopasowuje się tylko do strony, która żadnego wpisu jeszcze nie " +
    "ma - i wtedy jej ten wpis dopisuje. Strona z innym wpisem w rejestrze to " +
    "nie jest ta sama osoba, choćby nazywała się tak samo. " +
    "Dodatkowo pipeline podaje teraz wprost id strony, na której dana osoba " +
    "już jest - bo 868 osób nie ma żadnego wpisu w rejestrze i dla nich " +
    "samo imię to za mało. Id wysyłane jest tylko wtedy, gdy pasowała " +
    "dokładnie jedna strona; przy dwóch pasujących pipeline nie zgaduje.",
  steps: [
    "Poproś o upload osoby, która jest już na stronie, ale w pipeline ma inną pisownię imienia (np. z drugim imieniem). Nie powinna powstać druga strona - ma się zaktualizować istniejąca.",
    "Sprawdź /admin/rewizje/kolejka: nie powinno przybyć nowej osoby o niemal identycznym imieniu.",
    "Otwórz osobę bez wypełnionego rejestr.io i poproś o jej upload - odnośnik do rejestru ma się pojawić na istniejącej stronie, bez zakładania nowej.",
    "Sprawdź przypadek odwrotny: dwie różne osoby o tym samym imieniu i nazwisku, o różnych wpisach w rejestrze, mają zostać dwiema stronami.",
    "Weź osobę bez wpisu w rejestrze, której strona nazywa się inaczej niż to, co przysyła pipeline (np. wielkimi literami albo z drugim imieniem) - i tak ma trafić na istniejącą stronę, bez zakładania nowej.",
  ],
  link: "/admin/rewizje/kolejka",
  area: "admin",
} satisfies QaItem;
