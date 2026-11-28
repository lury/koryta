import type { QaItem } from "../../qa";

export const order = 12;

export default {
  id: "feedback-button",
  title: "Przycisk „Zgłoś” na każdej stronie",
  description:
    "Każdy - także niezalogowany - może powiedzieć, co jest nie tak, bez " +
    "zakładania konta i bez szukania kontaktu. Zgłoszenie zabiera ze sobą " +
    "stronę, na której było pisane.",
  steps: [
    "Otwórz dowolną stronę osoby i kliknij „Zgłoś” w prawym dolnym rogu.",
    "Wybierz rodzaj, napisz kilka słów i wyślij - ma pojawić się podziękowanie.",
    "Zalogowany: sprawdź, że e-mail jest już wpisany, a pod spodem jest napisane, że zgłoszenie będzie podpisane.",
    "Wyczyść pole e-mail i wyślij ponownie - opis ma się zmienić na anonimowy.",
    "Wyloguj się i zgłoś coś jeszcze raz - ma się udać tak samo.",
  ],
  area: "public",
} satisfies QaItem;
