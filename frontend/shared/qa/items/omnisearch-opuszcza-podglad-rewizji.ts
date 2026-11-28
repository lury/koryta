import type { QaItem } from "../../qa";

export const order = 62;

export default {
  id: "omnisearch-opuszcza-podglad-rewizji",
  title: "Wyszukiwarka wychodzi z podglądu rewizji",
  description:
    "Profil otwarty z kolejki rewizji albo z „Moich propozycji” ma w adresie " +
    "parametr rewizji i pokazuje proponowane zmiany nałożone na dane osoby. " +
    "Wyszukanie kogoś innego przenosiło ten parametr na nowy adres, więc na " +
    "profilu kolejnej osoby dalej widać było poprzednią rewizję - wyglądało " +
    "to tak, jakby wyszukiwarka w ogóle nie przeszła dalej. Filtry z adresu " +
    "zostają teraz tylko wtedy, gdy wybór z listy nie zmienia strony, na " +
    "przykład przy wyborze partii w tabeli.",
  steps: [
    "Otwórz profil dowolnej osoby w podglądzie rewizji - z panelu rewizji albo z „Moich propozycji” w swoim profilu. U góry strony jest wtedy niebieska informacja o podglądzie propozycji.",
    "W wyszukiwarce na górze wpisz nazwisko innej osoby i wybierz ją z listy.",
    "Sprawdź, że otworzył się profil wybranej osoby, bez paska podglądu rewizji, i że w adresie nie ma już parametru revisionId.",
    "Wejdź na /eksploruj/tabela, ustaw dowolny filtr, a potem wybierz partię z wyszukiwarki - poprzedni filtr ma zostać.",
  ],
  link: "/profil",
  area: "contributor",
} satisfies QaItem;
