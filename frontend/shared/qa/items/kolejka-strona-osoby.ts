import type { QaItem } from "../../qa";

export const order = 236;

export default {
  id: "kolejka-strona-osoby",
  title: "„Eksploruj nowe” pokazuje pod tabelą całą stronę osoby",
  description:
    "Pod wierszem z osobą /eksploruj/nowe nie ma już osobnych kart kolejki, tylko ta sama strona, którą osoba ma pod swoim adresem: historia powiązań z „Dodaj” i źródłami, zmiany na stanowisku, notatki, graf, fakty z artykułów i dyskusja. Kroki „Notatka” i „Głos” odhaczają się po zapisaniu notatki i po głosie z nagłówka strony, a zaproponowana zmiana jest podglądem tylko przy osobie, której dotyczy. Mapy i pojedynczych przycisków wyszukiwania nie ma, tak jak na stronie osoby: „Eksploruj” w wierszu dalej otwiera wszystkie wyszukiwania naraz.",
  steps: [
    "Otwórz /eksploruj/nowe. Pod tabelą z jedną osobą ma być jej strona: imię i nazwisko, partia, „Historia powiązań” z przyciskiem „Dodaj”, niżej notatki, graf i dyskusja.",
    "Zapisz notatkę na stronie osoby - krok „Notatka” na górze ma się odhaczyć. Na komputerze zagłosuj strzałką w nagłówku strony - ma się odhaczyć „Głos”, a głos w wierszu tabeli ma pokazać to samo.",
    "Kliknij „Zaproponuj zmianę” w nagłówku strony i wyślij zmianę - strona ma pokazać jej podgląd. Kliknij „Następna osoba” - przy następnej osobie podglądu ma nie być.",
  ],
  link: "/eksploruj/nowe",
  area: "contributor",
} satisfies QaItem;
