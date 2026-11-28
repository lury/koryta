import type { QaItem } from "../../qa";

export const order = 88;

export default {
  id: "zrodlo-w-notatce-oznacza-osobe",
  title: "Źródło dopisane do notatki oznacza osobę jako wspomnianą w artykule",
  description:
    "Dopisanie źródła tworzyło stronę artykułu i na tym się kończyło - " +
    "artykuł trafiał do bazy niepowiązany z nikim, więc jego sekcja " +
    '"Wspomniane osoby i instytucje" była pusta, a graf pod nim nie miał ' +
    "co narysować. Teraz w tym samym zapisie powstaje powiązanie z osobą " +
    "albo spółką, przy której notatka wisi. Ten sam adres wpisany na dwa " +
    "sposoby (z www, ze slashem na końcu) to jeden artykuł, a nie dwa.",
  steps: [
    "Zaloguj się i dodaj do notatki przy osobie źródło z adresem artykułu.",
    'Zapisz i przejdź żetonem "Artykuł" na stronę artykułu.',
    'Sprawdź, że osoba jest w "Wspomniane osoby i instytucje" (jako szkic).',
    "Wróć do notatki i zapisz ją jeszcze raz - nie powinno powstać drugie powiązanie ani drugi artykuł.",
  ],
  area: "contributor",
} satisfies QaItem;
