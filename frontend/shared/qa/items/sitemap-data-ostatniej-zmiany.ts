import type { QaItem } from "../../qa";

export const order = 220;

export default {
  id: "sitemap-data-ostatniej-zmiany",
  title: "Mapa strony mówi wyszukiwarkom, kiedy strona się zmieniła",
  description:
    "Plik /sitemap.xml wymieniał prawie siedem tysięcy adresów i przy " +
    "żadnym nie podawał daty, więc Google odwiedzał je w kolejności " +
    "własnego zgadywania. Teraz każdy adres ma datę ostatniej zmiany, a " +
    "liczy się do niej nie tylko poprawka samej strony: opublikowanie " +
    "zatrudnienia zmienia stronę firmy dokładnie tak samo jak stronę " +
    "osoby, a firma o tym do tej pory nie wiedziała - 7 na 10 adresów w " +
    "mapie to instytucje, w które powiązania tylko celują i których przy " +
    "tym nikt nie dotyka. Data nie rusza się natomiast od głosu, od " +
    "przeliczenia statystyk, od powiązania czekającego jeszcze na " +
    "publikację ani od nocnego wczytania danych, które o stronie niczego " +
    "nowego nie powiedziało: data skacząca bez powodu jest gorsza niż jej " +
    "brak, bo Google przestaje wtedy wierzyć całej witrynie. Dla " +
    "czytelnika nic się nie zmienia.",
  steps: [
    "Otwórz /sitemap.xml, a jeśli jest spisem kilku map, jedną z nich (np. /sitemap-osoby.xml), i sprawdź, że pod „loc” stoi „lastmod” z datą, i że różne strony mają różne daty.",
    "Opublikuj jako admin powiązanie osoby z instytucją w /admin/krawedzie. Po minucie data przy obu stronach ma być dzisiejsza - w samej mapie zobaczysz to, gdy wygaśnie jej cache, czyli do sześciu godzin.",
    "Zagłosuj na dowolną osobę i sprawdź, że data przy jej adresie się nie ruszyła - ocena to nie zmiana treści.",
  ],
  link: "/sitemap.xml",
  area: "admin",
} satisfies QaItem;
