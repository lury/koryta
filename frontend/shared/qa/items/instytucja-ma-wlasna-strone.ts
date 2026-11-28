import type { QaItem } from "../../qa";

export const order = 21;

export default {
  id: "instytucja-ma-wlasna-strone",
  title: "Instytucja ma znów własną stronę",
  description:
    "Kliknięcie w spółkę nie przenosi już do tabeli osób przefiltrowanej " +
    "do niej, tylko na stronę tej spółki: numery rejestrowe z odnośnikiem " +
    "do rejestr.io, siedziba, właściciele, spółki zależne, obecny skład, " +
    "historia powiązań i graf. Tabela jest nadal dostępna przyciskiem " +
    "„Eksploruj powiązania”.",
  steps: [
    "W wyszukiwarce u góry wpisz nazwę spółki i wybierz ją - ma się otworzyć adres /instytucja/… , a nie /eksploruj/tabela.",
    "Sprawdź kartę na górze: nazwa, „Instytucja publiczna”, numer KRS jako podkreślony odnośnik (nie jasnozielony) prowadzący do rejestr.io.",
    "Kliknij „Eksploruj powiązania” - ma otworzyć starą tabelę przefiltrowaną do tej spółki.",
    "Sprawdź, że sekcja „Historia powiązań” pojawia się raz, a nie dwa razy (kiedyś te same powiązania rysowały się też jako kafelki niżej).",
    "Wejdź na stronę osoby i kliknij w jej miejsce pracy - ma prowadzić na stronę spółki.",
    "Otwórz stronę instytucji bez numeru KRS (ministerstwo, urząd) - zamiast KRS mają być REGON i NIP.",
  ],
  link: "/",
  area: "public",
} satisfies QaItem;
