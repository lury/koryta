import type { QaItem } from "../../qa";

export const order = 224;

export default {
  id: "lastmod-po-zmianach-calej-witryny",
  title: "Mapa strony odnotowuje zmiany całej witryny i zmiany składu spółek",
  description:
    "Data ostatniej zmiany w /sitemap.xml ruszała się tylko wtedy, gdy ktoś zmienił samą stronę albo opublikowane powiązanie. " +
    "Teraz rusza się też, gdy zmiana całej witryny dotarła do strony (poprawione adresy i opisy z 24 października, obecny skład spółek z osobami bez opublikowanej strony), i gdy w obecnym składzie spółki ktoś dochodzi, odchodzi albo zmienia funkcję - także osoba bez opublikowanej strony.",
  steps: [
    "Po przeliczeniu dat (skrypty stamp-site-changes i correct-10-24-stamp) otwórz /sitemap.xml, a jeśli jest spisem kilku map, mapę instytucji: spółki, których obecny skład wymienia osobę bez opublikowanej strony, mają datę nie starszą niż 24 października 2026, 21:46. Strony, do których zmiany z 24 października nie dotarły, zachowują wcześniejszą datę.",
    "Po wdrożeniu funkcji dodaj w spółce nowe zatrudnienie osoby bez opublikowanej strony: po kilku minutach data przy tej spółce jest dzisiejsza (w samej mapie po wygaśnięciu jej cache, do sześciu godzin).",
  ],
  link: "/sitemap.xml",
  area: "admin",
} satisfies QaItem;
