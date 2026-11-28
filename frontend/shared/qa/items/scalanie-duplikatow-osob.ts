import type { QaItem } from "../../qa";

export const order = 68;

export default {
  id: "scalanie-duplikatow-osob",
  title: "Duplikat osoby można scalić z właściwą stroną",
  description:
    "Jedna osoba na dwóch stronach to dwie połowy tego, co o niej wiadomo, i " +
    "żadnej z nich nie da się po prostu usunąć. Admin wskazuje więc, która " +
    "strona jest duplikatem, a której powiązania mają zostać - i wszystkie " +
    "powiązania duplikatu przenoszą się na stronę, która zostaje. Powtórzone " +
    "zatrudnienia znikają, bo powiedziane dwa razy nie mówią nic więcej; " +
    "powtórzone kandydatury zostają i są zgłaszane do przejrzenia, bo dwa " +
    "identycznie zapisane starty w wyborach potrafią być dwoma prawdziwymi. " +
    "Duplikat nie znika z bazy: jego adres nadal działa i przekierowuje na " +
    "stronę, która została, więc stare linki się nie psują. Przed scaleniem " +
    "okno pokazuje, co dokładnie się stanie.",
  steps: [
    "Jako admin wejdź na stronę osoby, która ma swój duplikat, i otwórz „Ta strona to duplikat”.",
    "Wskaż drugą stronę i wpisz powód. Okno ma najpierw pokazać podsumowanie: ile powiązań się przeniesie, ile zniknie jako powtórzenie, ile zostanie do przejrzenia.",
    "Potwierdź. Powinno przerzucić cię na stronę, która została, i mieć na niej powiązania z obu.",
    "Wejdź na stary adres duplikatu - ma przekierować na stronę, która została, a nie pokazać 404.",
    "Sprawdź /admin/audyt (log admina): ma być wpis „Scalenie duplikatu” z oboma id.",
  ],
  area: "admin",
} satisfies QaItem;
