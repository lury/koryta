import type { QaItem } from "../../qa";

export const order = 113;

export default {
  id: "fakty-potwierdzone-na-gorze",
  title: "Potwierdzone fakty na górze, reszta pod nimi i wyszarzona",
  description:
    "Sekcja „Fakty z artykułów” dzieli się teraz na dwa bloki: to, co " +
    "czytelnicy potwierdzili, idzie na górę, a to, czego nikt jeszcze " +
    "nie sprawdził (i to, co zakwestionowano), ląduje pod spodem na " +
    "szarym tle. Każda karta, na której ktoś już głosował, ma dodatkowo " +
    "mały znacznik z liczbą głosów - „Potwierdzony · 2 głosy”, " +
    "„Zakwestionowany · 1 głos”; karta, na którą nikt nie głosował, nie " +
    "pokazuje nic, żeby nie robić kolumny zer.",
  steps: [
    "Zaloguj się i wejdź na stronę osoby z kilkoma faktami (na seedzie: /osoba/anna-nowak-3).",
    "Oceń jeden z faktów jako poprawny (zielony ptaszek) i odczekaj minutę - odpowiedź jest cache'owana 60 s.",
    "Odśwież stronę: oceniony fakt ma być w bloku „POTWIERDZONE PRZEZ CZYTELNIKÓW” na górze, a reszta pod nagłówkiem „JESZCZE NIESPRAWDZONE”.",
    "Karty w drugim bloku mają mieć szare tło, ale tekst cytatu ma dalej być czytelny.",
    "Na potwierdzonej karcie ma być zielony znacznik „Potwierdzony · 1 głos”.",
    "Jeśli żaden fakt nie jest jeszcze oceniony, nagłówków bloków ma nie być w ogóle - jedna zwykła lista, tak jak wcześniej.",
  ],
  link: "/osoba/anna-nowak-3",
  area: "public",
} satisfies QaItem;
