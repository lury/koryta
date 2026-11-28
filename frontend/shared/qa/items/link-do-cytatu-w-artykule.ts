import type { QaItem } from "../../qa";

export const order = 111;

export default {
  id: "link-do-cytatu-w-artykule",
  title: "Link z cytatu częściej trafia w podświetlony fragment artykułu",
  description:
    "Link z cytatu na karcie faktu buduje teraz kilka zapasowych " +
    "zaczepień zamiast jednego: obok całego zakresu „od-do” dokłada " +
    "pojedyncze zdania cytatu, więc podświetlenie działa też tam, gdzie " +
    "scraper skleił śródtytuł z akapitem (przypadek rmf24.pl) - " +
    "fragment tekstu nie może przekroczyć granicy bloku i cały zakres " +
    "przepadał po cichu. Dodatkowo cytat jest teraz czyszczony ze " +
    "spacji przed przecinkiem i kropką, którą zostawia tokenizer " +
    "potoku, a przy cytacie doszedł przycisk kopiowania - na wypadek " +
    "gdy przeglądarka otworzy artykuł w karcie w tle (ctrl+klik) i w " +
    "ogóle nie zastosuje podświetlenia.",
  steps: [
    "Zaloguj się i wejdź na stronę osoby z faktami albo na /ekstrakcje.",
    "Najedź na blok z cytatem - w prawym górnym rogu ma się uwyraźnić przycisk kopiowania.",
    "Podpis nad cytatem ma brzmieć „Zobacz cytat na <domena>”, a nie „Zobacz artykuł”.",
    "Kliknij cytat zwykłym kliknięciem - artykuł ma się otworzyć w nowej karcie i przewinąć do podświetlonego fragmentu.",
    "Kliknij cytat z ctrl (karta w tle) - jeśli przeglądarka nie podświetli fragmentu, kliknij przycisk kopiowania, przejdź do artykułu i wklej cytat w Ctrl+F: ma się znaleźć.",
    "Ikona przycisku ma na dwie sekundy zmienić się w ptaszka po skopiowaniu.",
  ],
  link: "/ekstrakcje",
  area: "contributor",
  fixes: ["pqJ2F41aikHuUFQd8WOK"],
} satisfies QaItem;
