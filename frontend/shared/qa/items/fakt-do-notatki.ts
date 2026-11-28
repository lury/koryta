import type { QaItem } from "../../qa";

export const order = 125;

export default {
  id: "fakt-do-notatki",
  title: "Wydobyty fakt można przenieść do własnej notatki",
  description:
    "Na stronie osoby przy każdym wydobytym fakcie jest teraz przycisk " +
    "„Dodaj do notatki”. Jednym kliknięciem fakt trafia do Twojej " +
    "notatki o tej osobie jako źródło: zdanie z artykułu w cudzysłowie, " +
    "opis czego dotyczy (zatrudnienie, partia, relacja) i link do " +
    "artykułu. Do tej pory ocena „poprawny fakt” była liczbą, której " +
    "nikt nie odczytywał - notatka jest publiczna, stoi w sekcji " +
    "„Notatki” wyżej na stronie pod Twoim nazwiskiem, i to z niej " +
    "powstaje potem strona artykułu przy kolejnym zapisie notatki. " +
    "Przycisk sam się wyłącza i pokazuje „W Twojej notatce”, jeśli " +
    "cytat już tam jest - także wtedy, gdy dopisałeś coś wokół niego. " +
    "Fakt bez cytatu i bez linku do artykułu przycisku nie dostaje.",
  steps: [
    "Zaloguj się i wejdź na stronę osoby, która ma sekcję „Fakty z artykułów”.",
    "Na dowolnej karcie faktu kliknij „Dodaj do notatki”.",
    "Sprawdź w sekcji „Notatki” wyżej, że pojawił się wpis z cytatem i linkiem do artykułu.",
    "Wróć do karty - przycisk powinien mówić „W Twojej notatce” i być nieaktywny.",
    "Dopisz coś w tym wpisie notatki i zapisz notatkę - przycisk nadal ma mówić „W Twojej notatce”, a nie proponować dodania drugi raz.",
    "Dodaj do notatki drugi fakt - pierwszy wpis ma zostać na miejscu.",
  ],
  link: "/osoba/agnieszka-zurek-xQwaKwMSFZeDTc8Tz1Ce",
  area: "contributor",
} satisfies QaItem;
