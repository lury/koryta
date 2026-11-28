import type { QaItem } from "../../qa";

export const order = 142;

export default {
  id: "wiadomo-jak-mozna-pomoc",
  title: "Strona główna i pomoc mówią wprost, co jest do zrobienia",
  description:
    "Sekcja „Zostało nam jeszcze dużo osób” nie mówiła, do czego te osoby " +
    "są potrzebne, i kończyła się dwoma jednakowymi zielonymi przyciskami " +
    "proszącymi o to samo. Teraz nagłówek mówi, że chodzi o sprawdzanie, " +
    "jest jeden wyróżniony przycisk prowadzący prosto do kolejki, a pasek " +
    "postępu ma uczciwe podpisy. Strona pomocy zaczyna się od sześciu dróg " +
    "do wyboru i przy każdej rzeczy pisze, czy trzeba konta.",
  steps: [
    "Otwórz stronę główną i przewiń do sekcji z paskiem postępu - nagłówek ma kończyć się słowami „do sprawdzenia”.",
    "W sekcji ma być jeden wypełniony przycisk „Sprawdź pierwszą osobę”, a przy nim dwa mniej wyróżnione: „Zgłoś błąd albo pomysł” i „Inne sposoby pomocy”.",
    "Kliknij „(i)” przy nagłówku - ma się pokazać wyjaśnienie, na czym polega sprawdzanie.",
    "Kliknij „Zgłoś błąd albo pomysł” - ma się otworzyć to samo okno co po kliknięciu „Zgłoś” w prawym dolnym rogu.",
    "Kliknij „Inne sposoby pomocy” - na stronie „Jak możesz pomóc” sześć kafelków ma być widoczne bez przewijania.",
    "Kliknij kafelek „Mam minutę” - strona ma przewinąć się do sekcji, w której każda karta ma plakietkę „bez konta”.",
    "W sekcji „Wiesz coś, czego my nie wiemy” kliknij „Dopisz brakującą osobę albo spółkę” - ma się otworzyć okno dodawania osoby.",
    "Na telefonie (375 px) sprawdź, że liczby z paska postępu są tylko w legendzie, a nie na samym pasku, i nic nie wystaje poza ekran.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
