import type { QaItem } from "../../qa";

export const order = 174;

export default {
  id: "admin-procesy-importy",
  title: "Procesy: duże importy na stronę",
  description:
    "Strona /admin/procesy pokazuje teraz też duże importy - osób, firm, ocen modeli i faktów z artykułów - z tym, ile stron każde uruchomienie utworzyło, ile zaktualizowało, a ilu nie udało się zapisać, oraz planowany codzienny import osób. Stronę widzi tylko właściciel serwisu.",
  steps: [
    "Otwórz /admin/procesy - w „Na żądanie” mają być też „Import firm”, „Oceny modeli” i „Import faktów z artykułów”, a w „Według harmonogramu”, pod „Kopią bazy Firestore”, „Import osób na stronę”.",
    "Rozwiń „Import osób na stronę” - ma pokazać, że rusza w nocy na VM, polecenie koryta_people_import --scope priority --max-uploads 100 i zadania do wdrożenia; po pierwszym imporcie jego uruchomienia mają mieć liczby po polsku, np. „zaktualizowanych” i „nowych zatrudnień”.",
  ],
  link: "/admin/procesy",
  area: "admin",
} satisfies QaItem;
