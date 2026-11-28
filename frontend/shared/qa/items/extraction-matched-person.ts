import type { QaItem } from "../../qa";

export const order = 28;

export default {
  id: "extraction-matched-person",
  title: "Fakt z artykułu pokazuje, do kogo z bazy został przypisany",
  description:
    "Potok wyszukiwania faktów potrafi już powiedzieć, które osoby z naszej " +
    "bazy są w artykule wymienione, i każdy fakt jest łączony z tą z nich, " +
    "której imię i nazwisko nosi. Na karcie faktu ta osoba jest " +
    "podlinkowana i podpisana jako osoba w bazie. Łączenie po nazwisku " +
    "bywa mylne - dwie osoby o tym samym nazwisku wyglądają tak samo - " +
    "więc pod nazwiskiem jest przycisk To nie ta osoba, którym można " +
    "zgłosić, że fakt dotyczy kogoś innego.",
  steps: [
    "Wejdź na /ekstrakcje i rozwiń artykuł: fakt dopasowany do kogoś z bazy ma pod nazwiskiem podpis osoba w bazie, a niedopasowany tylko osoba.",
    "Kliknij podlinkowane nazwisko - ma otworzyć stronę tej osoby w bazie, nie artykuł.",
    "Kliknij To nie ta osoba - napis ma się zmienić na Zgłoszono złe dopasowanie, a karta ma zostać na miejscu (to nie jest ocena faktu).",
    "Kliknij jeszcze raz - zgłoszenie ma zostać cofnięte.",
    "Wejdź na /ekstrakcje/kategoryzacja - ta sama informacja i ten sam przycisk mają być na karcie do oceny.",
    "Zgłoś złe dopasowanie i wróć na stronę po dłuższej chwili - fakt ma dalej być podpisany jako zgłoszony (podliczenie głosów idzie w tle, a odpowiedź jest przez minutę cache'owana).",
  ],
  link: "/ekstrakcje",
  area: "contributor",
} satisfies QaItem;
