import type { QaItem } from "../../qa";

export const order = 44;

export default {
  id: "graf-legenda-kolorow-partii",
  title: "Legenda grafu mówi, co znaczą kolory osób",
  description:
    "W grafie kółko osoby jest pomalowane na kolor jej partii, ale legenda " +
    "nad płótnem tłumaczyła dotąd tylko kształty - więc niebieskie, " +
    "granatowe i zielone kółka nie znaczyły dla czytelnika nic. Teraz " +
    "legenda wymienia partie, które faktycznie są na ekranie (nie całą " +
    "listę ośmiu), a niebieski jest podpisany jako osoba bez partii. Nowa " +
    "Lewica i SLD mają ten sam kolor - to ta sama partia po zmianie nazwy - " +
    "więc stoją w jednej pozycji. Przy okazji: osoba z partii, dla której " +
    "nie mamy koloru (np. " +
    "Razem), była rysowana na czarno - teraz jest niebieska jak reszta " +
    "bezpartyjnych. Podpisy osób w dalszym kręgu skracają drugie imię do " +
    "inicjału zamiast ucinać nazwisko: było „Sławomir Andrzej…”, jest " +
    "„Sławomir A. Nowicki”.",
  steps: [
    "Wejdź na stronę osoby, która ma powiązania z politykami (np. /osoba/pawel-orlowski-hvMeVASGU0uBMuwSsRM0), i zjedź do grafu.",
    "Nad płótnem sprawdź legendę: po kształtach mają być kolory partii widocznych w grafie, każdy z nazwą partii.",
    "Sprawdź, że nie ma tam partii, której nikt na płótnie nie reprezentuje, a Nowa Lewica i SLD (jeśli obie są) stoją razem w jednej pozycji.",
    "Sprawdź podpisy węzłów w drugim kroku: osoba z dwoma imionami ma być podpisana z nazwiskiem (np. „Sławomir A. Nowicki”), a nie uciętą po imionach.",
    "Sprawdź, że żaden węzeł osoby nie jest czarny.",
  ],
  area: "public",
} satisfies QaItem;
