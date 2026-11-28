import type { QaItem } from "../../qa";

export const order = 96;

export default {
  id: "statystyki-mniej-rodzajow-zmian",
  title: "Wykres aktywności ma cztery rodzaje zmian zamiast siedmiu",
  description:
    "Wykres „Co się działo w bazie” dzielił każdy dzień na siedem pasków, " +
    "więc legenda była dłuższa niż to, co z niej wynikało. Ocena osoby i " +
    "ocena ekstrakcji to teraz jedna „Ocena”, komentarze zniknęły, a z " +
    "działań administratora zostały tylko opublikowane strony - reszta " +
    "kolejki jest w panelu admina. Słupki są też szersze, bo przy " +
    "trzydziestu dniach odstęp między nimi był większy niż one same, a " +
    "przerwy między kolorami w jednym słupku są o połowę cieńsze.",
  steps: [
    "Wejdź na /eksploruj/statystyki i spójrz na kafelki nad wykresem - ma ich być cztery, nie siedem.",
    "Na wykresie „Co się działo w bazie” słupki mają niemal stykać się bokami; przełącz zakres na 7 i 90 dni i sprawdź, że w obu wygląda to sensownie.",
    "Przełącz wykres na widok tabeli (ikona obok) - kolumny mają odpowiadać tym samym czterem rodzajom.",
    "W tabeli „Najaktywniejsi” liczby w kolumnie „Ocena” to suma dawnych ocen osób i ocen ekstrakcji, a „Razem” nie liczy już komentarzy.",
  ],
  link: "/eksploruj/statystyki",
  area: "public",
} satisfies QaItem;
