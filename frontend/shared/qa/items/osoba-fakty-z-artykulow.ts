import type { QaItem } from "../../qa";

export const order = 43;

export default {
  id: "osoba-fakty-z-artykulow",
  title: "Na stronie osoby widać fakty, które model przypisał właśnie jej",
  description:
    "Pod grafem powiązań doszła sekcja „Fakty z artykułów”: wszystkie " +
    "wydobyte z prasy fakty, które potok dopasował do tej konkretnej " +
    "osoby z bazy - dopasowanie idzie po identyfikatorze ustalonym przy " +
    "wgrywaniu, a nie po nazwisku, więc imiennik nie dostaje cudzych " +
    "faktów. Karty są te same co na /ekstrakcje, po dwie w rzędzie na " +
    "szerszym ekranie. Same fakty są tylko dla zalogowanych - to " +
    "niesprawdzone jeszcze zdania o konkretnej osobie, dokładnie z tego " +
    "samego powodu, dla którego notatki na stronie osoby też wymagają " +
    "logowania. Niezalogowany widzi tylko, ile ich znaleźliśmy, rozmazany " +
    "podgląd i przycisk „Zaloguj się lub załóż konto”. Rozmycie jest samą " +
    "dekoracją nad pustymi paskami: treść faktów w ogóle nie jest wysyłana " +
    "na taką stronę, więc nie ma jej ani w źródle strony, ani dla " +
    "wyszukiwarek.",
  steps: [
    "Zaloguj się i wejdź na stronę osoby, która ma dopasowane fakty (na seedzie: /osoba/anna-nowak-3).",
    "Zjedź na dół, pod graf powiązań - ma być nagłówek „Fakty z artykułów” i karty faktów.",
    "Na szerokim ekranie karty mają stać po dwie w rzędzie, na wąskim jedna pod drugą.",
    "Sprawdź, że karta ma przycisk „To nie ta osoba”. (Przyciski oceny doszły później - patrz „Fakty można oceniać od razu na stronie osoby”.)",
    "Wyloguj się i odśwież tę samą stronę - ma zostać nagłówek, zdanie „Znaleźliśmy N faktów…”, rozmazany podgląd i przycisk logowania.",
    "Otwórz źródło tej wylogowanej strony (Ctrl+U) i poszukaj treści faktu - nie ma go tam być.",
    "Kliknij „Zaloguj się lub załóż konto” i zaloguj się - ma cię odesłać z powrotem na stronę tej samej osoby, już z faktami.",
    "Wejdź na stronę osoby bez dopasowanych faktów - ani zalogowany, ani wylogowany nie ma zobaczyć nagłówka.",
  ],
  area: "public",
} satisfies QaItem;
