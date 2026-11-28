import type { QaItem } from "../../qa";

export const order = 45;

export default {
  id: "admin-usuwanie-powiazania",
  title: "Admin może usunąć powiązanie ze strony podmiotu",
  description:
    "Na stronie osoby, spółki i regionu, w kolejce /eksploruj/nowe i w " +
    "szufladzie /eksploruj/tabela przy każdym powiązaniu widać teraz - " +
    "tylko dla admina - kosz. Kliknięcie pyta o powód i od razu zdejmuje " +
    "powiązanie ze strony i z grafu; nie trafia ono do kolejki rewizji, bo " +
    "nie ma tu drugiej opinii, na którą warto czekać. Powstało to dla " +
    "powiązań po źle scalonej osobie: zatrudnienia z niewłaściwej połowy " +
    "nie są niczyją tezą, tylko śmieciem po scaleniu. Powiązanie nie znika " +
    "z bazy - zostaje w niej razem z powodem i autorem usunięcia, więc " +
    "widać, kto i dlaczego je zdjął. Cofnąć to można na razie tylko w " +
    "bazie: żaden ekran w aplikacji nie przywraca usuniętego powiązania, " +
    "więc pytaj o powód serio. Przy okazji: usunięte powiązanie znika też " +
    "zalogowanym; wcześniej filtr omijał osoby oglądające wersje " +
    "niezatwierdzone, więc admin po usunięciu dalej widział je na stronie.",
  steps: [
    "Wejdź zalogowany jako admin na stronę osoby z powiązaniami, np. /entity/person/<id>. W „Historii powiązań” każdy wiersz ma po prawej czerwony kosz, obok ikony źródeł.",
    "Zaloguj się jako zwykły użytkownik (albo wyloguj) i odśwież tę samą stronę - kosza nie ma.",
    "Jako admin kliknij kosz. Okienko ma podać, o które powiązanie chodzi („Osoba - rola - firma”), a przycisk „Usuń powiązanie” ma być nieaktywny, dopóki nie wpiszesz powodu.",
    "Wpisz powód i potwierdź. Powiązanie ma zniknąć z listy bez odświeżania strony, a na dole pojawić się „Powiązanie zostało usunięte”.",
    "Odśwież stronę - powiązania ma dalej nie być, ani na liście, ani w grafie na dole.",
    "Otwórz stronę drugiej strony powiązania (np. firmy) - tam też ma go nie być.",
    "Wejdź na stronę spółki (/instytucja/...): kosz jest tak samo przy wierszach „Historii powiązań” oraz przy „Właścicielach” i „Spółkach zależnych”.",
    "Wejdź na stronę regionu (/region/krakow-teryt1261): powiązania są tam kartami, a kosz siedzi w rogu karty. Artykuły i tematy mają własne widoki i kosza nie mają - to nie jest błąd.",
    "Wejdź na /eksploruj/nowe jako admin: w „Historii powiązań” osoby z kolejki jest ten sam kosz. Usuń powiązanie - ma zniknąć bez przeładowania strony i bez przeskoku na inną osobę.",
    "Wejdź na /eksploruj/tabela, kliknij osobę, żeby otworzyć szufladę z boku: kosz jest i tam, przy powiązaniach na dole szuflady. To samo w /admin/notatki.",
    "Kliknięcie kosza nigdzie nie przechodzi - wiersz i karta same są linkami do drugiej strony powiązania, więc sprawdź, że po kliknięciu zostajesz na miejscu.",
  ],
  area: "admin",
} satisfies QaItem;
