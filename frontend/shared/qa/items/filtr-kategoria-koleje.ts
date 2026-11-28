import type { QaItem } from "../../qa";

export const order = 30;

export default {
  id: "filtr-kategoria-koleje",
  title: "Filtr kategorii firm: koleje",
  description:
    "Do filtra kategorii na Eksploruj doszła trzecia pozycja - „Koleje” - " +
    "obok szpitali oraz wodociągów i kanalizacji. Łapie przewoźników " +
    "kolejowych (pasażerskich i towarowych), spółki od infrastruktury " +
    "torowej i producentów taboru, a do tego imiennie te spółki grupy PKP, " +
    "których po kodach PKD nie da się rozpoznać - i imiennie odsiewa firmy " +
    "drogowe czy kopalnie, które mają kod kolejowy tylko dlatego, że mają " +
    "własną bocznicę. Kategorie wylicza pipeline przy imporcie spółki, " +
    "więc firma dostaje etykietę „Koleje” dopiero po kolejnym przejściu " +
    "importu spółek.",
  steps: [
    "Wejdź na /eksploruj/tabela i rozwiń filtry. Lista „Kategoria” ma mieć trzy pozycje: Szpitale, Wodociągi i kanalizacja, Koleje.",
    "Wybierz „Koleje” - w tabeli mają zostać tylko osoby powiązane ze spółkami kolejowymi (np. PKP), a adres ma dostać `?category=koleje`.",
    "Sprawdź, że są tam też przewoźnicy z nowszym PKD: PKP Szybka Kolej Miejska w Trójmieście, Łódzka Kolej Aglomeracyjna, Koleje Dolnośląskie, Koleje Wielkopolskie.",
    "I spółki bez kolejowego PKD: Polskie Koleje Państwowe, PKP Informatyka, PKP Cargotabor, PGE Energetyka Kolejowa Operator.",
    "A nie ma być: Instytutu Badawczego Dróg i Mostów, Kopalni Wapienia „Czatkowice”, Orlen Aviation ani Polskich Kolei Linowych.",
    "Odśwież stronę z tym adresem: filtr ma się odtworzyć z linku, a nie wrócić do „wszystkie”.",
    "To samo sprawdź na /eksploruj/nowe - ta sama lista kategorii, ta sama zawartość po wybraniu „Koleje”.",
    "Jeśli lista wyników jest pusta, to znaczy, że import spółek nie przeliczył jeszcze kategorii.",
  ],
  link: "/eksploruj/tabela",
  area: "public",
} satisfies QaItem;
