import type { QaItem } from "../../qa";

export const order = 34;

export default {
  id: "kategorie-firm-edytowalne",
  title: "Kategorie firmy można poprawić",
  description:
    "Kategoria firmy („Szpitale”, „Wodociągi i kanalizacja”, „Koleje”) " +
    "przestała być tylko wyliczana z kodów PKD i jest teraz zwykłym polem " +
    "wpisu: widać ją na stronie instytucji, jest w formularzu zmiany, " +
    "przechodzi przez rewizje i ma swoją historię. Kod PKD mówi, czym " +
    "firma się zajmuje, a nie do jakiej branży należy - kopalnia z własną " +
    "bocznicą ma kod kolejowy - więc wyliczenie bywa błędne i musi dać się " +
    "poprawić z poziomu strony. Jeśli ktoś ustawi kategorie ręcznie, " +
    "kolejny import spółek już ich nie nadpisze; puste zaznaczenie też " +
    "jest odpowiedzią i też jest chronione.",
  steps: [
    "Wejdź na stronę instytucji, która ma kategorię (np. spółka kolejowa). Obok „Instytucja publiczna” ma być szary znacznik z nazwą kategorii.",
    "Kliknij ten znacznik - ma przenieść na /eksploruj/tabela z ustawionym filtrem tej kategorii.",
    "Kliknij „Zaproponuj zmianę”. Pod pytaniem o właściciela ma być pole „Kategorie” z trzema pozycjami, wstępnie zaznaczone tym, co jest zapisane.",
    "Zmień zaznaczenie i wyślij. W podglądzie rewizji ma się pokazać wiersz „kategorie” ze starą i nową wartością po polsku, a nie „categories”.",
    "Wyczyść zaznaczenie do zera i wyślij. To też ma być rewizja ze zmianą „kategorie”, a nie „brak zmian”.",
    "Zatwierdź rewizję w /admin/rewizje i sprawdź stronę instytucji oraz filtr na /eksploruj/tabela. Filtr czyta listę firm z godzinnego cache - jeśli nie widać od razu, odczekaj lub odśwież z `?latest=true`.",
    "Sprawdź, że w podglądzie rewizji NIE ma osobnego wiersza „categoriesSource” - to pole techniczne.",
    "Na stronie osoby to samo pole nie ma się pojawiać: kategorie ma tylko instytucja.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
