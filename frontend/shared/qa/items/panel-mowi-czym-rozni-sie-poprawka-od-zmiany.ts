import type { QaItem } from "../../qa";

export const order = 115;

export default {
  id: "panel-mowi-czym-rozni-sie-poprawka-od-zmiany",
  title: "Panel mówi, czym różni się poprawka od zmiany",
  description:
    "„Zaproponuj zmianę” ma teraz pod sobą zdanie o tym, które pola " +
    "poprawia i że propozycja czeka na zatwierdzenie, a przycisk " +
    "notatki, który wcześniej nazywał się „Zgłoś poprawkę”, nazywa się " +
    "„Opisz błąd”. Każdy z trzech przycisków notatek ma dymek mówiący, " +
    "do czego służy - dwie ścieżki trafiają do innych kolejek i teraz " +
    "widać to na ekranie.",
  steps: [
    "Zaloguj się i otwórz /eksploruj/tabela, kliknij nazwisko, żeby otworzyć panel boczny.",
    "Pod przyciskiem „Zaproponuj zmianę” przeczytaj nowe zdanie: poprawia metryczkę (imię i nazwisko, partia, data urodzenia, wykształcenie, linki), propozycja czeka na zatwierdzenie, cokolwiek innego - do notatki niżej.",
    "Niżej, w sekcji „Notatki”, sprawdź, że środkowy przycisk nazywa się „Opisz błąd”, a nie „Zgłoś poprawkę”.",
    "Najedź kursorem na „Dodaj źródło”, „Opisz błąd” i „Zgłoś brak” - każdy ma dymek mówiący, do czego służy; przy „Opisz błąd” dymek odsyła do „Zaproponuj zmianę” dla samej metryczki.",
    "Wyślij propozycję zmiany: zdanie pod przyciskiem znika, zostaje potwierdzenie „Zaproponowano zmianę” z linkiem do podglądu.",
    "Sprawdź to samo na /eksploruj/nowe, gdzie ten sam przycisk stoi w kolumnie obok notatek.",
  ],
  link: "/eksploruj/tabela",
  area: "contributor",
  fixes: ["QUAuKkMLMc6N2OFxFXWl"],
} satisfies QaItem;
