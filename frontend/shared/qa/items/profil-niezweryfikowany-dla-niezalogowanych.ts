import type { QaItem } from "../../qa";

export const order = 201;

export default {
  id: "profil-niezweryfikowany-dla-niezalogowanych",
  title:
    "Niezalogowani widzą imię i ostatnie stanowisko nieopublikowanej osoby",
  description:
    "Strona osoby, której nikt jeszcze nie sprawdził, pokazywała niezalogowanym tylko „Dostęp zastrzeżony”. Teraz pokazuje imię i nazwisko, ostatnie stanowisko jako pierwszy wiersz „Historii powiązań”, a pod nimi ramkę z przyciskami „Zaloguj się” i „Rejestracja” - nigdy partii ani kandydatur. Wyszukiwarka znów podpowiada takie osoby, bez żadnego dopisku.",
  steps: [
    "Wyloguj się i wpisz w wyszukiwarkę nazwisko osoby, której strona jest szkicem - podpowiedź jest, bez dopisku, pod opublikowanymi osobami.",
    "Otwórz ją - jest imię i nazwisko, „Historia powiązań” z jednym stanowiskiem i pod nią ramka z dwoma przyciskami; nigdzie nie ma partii, kandydatur ani zdjęcia.",
    "Kliknij „Rejestracja” - formularz otwiera się na rejestracji; po zalogowaniu wracasz na pełną stronę tej osoby.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
