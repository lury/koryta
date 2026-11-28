import type { QaItem } from "../../qa";

export const order = 254;

export default {
  id: "mapa-strony-osobno-dla-kazdego-typu",
  title: "Mapa strony ma osobny plik dla osób, instytucji, artykułów i reszty",
  description:
    "Plik /sitemap.xml wymieniał wszystkie adresy witryny naraz. Teraz jest spisem czterech map: osób, instytucji, artykułów i pozostałych stron razem z wpisami bloga. " +
    "Google ocenia, czy wierzyć datom ostatniej zmiany, osobno dla każdego pliku, więc dokładne daty osób nie tracą już przez daty instytucji, które zmieniają się częściej. W Search Console widać też, ile stron każdego typu jest w indeksie.",
  steps: [
    "Otwórz /sitemap.xml: zamiast listy stron są cztery linki, do /sitemap-osoby.xml, /sitemap-instytucje.xml, /sitemap-artykuly.xml i /sitemap-strony.xml.",
    "Otwórz każdy z nich: w pierwszym są tylko adresy /osoba/, w drugim /instytucja/, w trzecim /artykul/, a w czwartym strona główna, pozostałe stałe strony i wpisy bloga. Przy adresach osób, instytucji i artykułów stoi „lastmod” z datą.",
    "Otwórz /robots.txt: na końcu stoi „Sitemap: https://koryta.pl/sitemap.xml”.",
  ],
  link: "/sitemap.xml",
  area: "admin",
} satisfies QaItem;
