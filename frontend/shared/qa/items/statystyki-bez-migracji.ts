import type { QaItem } from "../../qa";

export const order = 70;

export default {
  id: "statystyki-bez-migracji",
  title: "Statystyki nie liczą migracji jako czyjejś pracy",
  description:
    "Skrypty migracyjne podpisują swoje zapisy własną nazwą, żeby dało się " +
    "sprawdzić, który przebieg co zmienił. Na wykresie aktywności wyglądało " +
    "to jak dzień pracy jednego człowieka: scalanie duplikatów osób zapisało " +
    "31 sierpnia 1081 propozycji zmian w kilka minut i przykryło sobą " +
    "wszystko, co zrobili ludzie. Teraz zapisy skryptów nie liczą się wcale " +
    "- tak samo jak od dawna nie liczą się oceny wystawione przez modele. " +
    "Same zmiany zostają w bazie i w historii strony, znikają tylko z " +
    "rankingu i z wykresu.",
  steps: [
    "Otwórz /eksploruj/statystyki z zakresem 30 dni. W „Kto tworzy koryta.pl” nikt nie powinien mieć kilkuset zmian z jednego dnia.",
    "Popatrz na wykres dzienny: 31 sierpnia ma być zwykłym dniem, a nie słupkiem kilkadziesiąt razy wyższym od pozostałych.",
    "Sprawdź kafelek „Propozycja zmiany”: liczba ma być porównywalna z tym, co widać przy zakresie 7 dni, a nie o rząd wielkości większa.",
    "Sprawdź, że Twój własny wiersz i Twoja pozycja w rankingu się nie zmieniły.",
    "Wejdź na stronę scaloną (taką z przekierowaniem do drugiej osoby) i sprawdź, że historia zmian nadal pokazuje, co zrobiła migracja.",
  ],
  link: "/eksploruj/statystyki",
  area: "public",
} satisfies QaItem;
